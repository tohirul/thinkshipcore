import { randomUUID } from "node:crypto";
import { runDeepAudit } from "../../core/prompt/agent.js";
import { runAllAudits, runSingleAudit } from "../services/auditService.js";
import {
  parseAllAuditsInput,
  parseCommonAuditInput,
} from "../validation/auditInput.js";

const CACHE_TTL_MS = Number(process.env.AUDIT_CACHE_TTL_MS ?? "60000");
const controllerResponseCache = new Map();
const DEEP_ANALYSIS_PROGRESS_INTERVAL_MS = 4_000;
const STATUS_TEMPLATES = {
  request_received: {
    status: "queued",
    progress: 0,
    message: "Audit request received.",
  },
  baseline_audit_started: {
    status: "running",
    progress: 10,
    message: "Baseline audits started.",
  },
  baseline_audit_progress: {
    status: "running",
    progress: 10,
    message: "Baseline audit progress updated.",
  },
  audit_report: {
    status: "running",
    progress: 65,
    message: "Baseline audit report generated.",
  },
  baseline_audit_completed: {
    status: "running",
    progress: 70,
    message: "Baseline audits completed.",
  },
  deep_analysis_started: {
    status: "running",
    progress: 80,
    message: "Groq deep analysis started.",
  },
  deep_analysis_progress: {
    status: "running",
    progress: 85,
    message: "Groq deep analysis in progress.",
  },
  deep_analysis_skipped: {
    status: "completed",
    progress: 90,
    message: "Deep analysis skipped because baseline report is already healthy.",
  },
  deep_analysis_completed: {
    status: "running",
    progress: 95,
    message: "Groq deep analysis completed.",
  },
  response_preparing: {
    status: "running",
    progress: 98,
    message: "Preparing final response payload.",
  },
  response_dispatched: {
    status: "completed",
    progress: 100,
    message: "Audit completed and final response payload sent.",
  },
  request_failed: {
    status: "failed",
    progress: 100,
    message: "Audit request failed.",
  },
};

function createSingleAuditHandler(type) {
  return async function handleSingleAudit(req, res, next) {
    try {
      const input = parseCommonAuditInput(req.body);
      const report = await runSingleAudit(type, input);
      res.status(200).json(report);
    } catch (error) {
      next(error);
    }
  };
}

export const analyzePerformance = createSingleAuditHandler("perf");
export const analyzeSeo = createSingleAuditHandler("seo");
export const analyzeSecurity = createSingleAuditHandler("security");

export async function analyzeAll(req, res, next) {
  try {
    const input = parseAllAuditsInput(req.body);
    const cacheKey = buildCacheKey("all", input);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      res.status(200).json(cached);
      return;
    }

    const report = await runAllAudits(input);
    setCachedResponse(cacheKey, report);
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
}

export async function analyzeDeep(req, res, next) {
  try {
    // 1. Run the standard hard-coded audits (Perf, SEO, Security)
    const input = parseAllAuditsInput(req.body);
    const cacheKey = buildCacheKey("deep", input);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      res.status(200).json(cached);
      return;
    }

    const standardReport = await runAllAudits(input);

    // 2. Pass the results to the AI Agent
    const aiAnalysis = shouldSkipDeepAnalysis(standardReport)
      ? createNominalDeepAnalysis()
      : await runDeepAudit(standardReport);

    // 3. Merge and return
    const responsePayload = {
      ...standardReport,
      deepAnalysis: aiAnalysis,
    };

    setCachedResponse(cacheKey, responsePayload);
    res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
}

export async function analyzeDeepProgress(req, res, next) {
  const requestId =
    typeof randomUUID === "function"
      ? randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  let connectionClosed = false;
  let baselineStartedCount = 0;
  let baselineCompletedCount = 0;
  let baselineTotalCount = 0;
  let latestProgress = 0;
  let deepAnalysisInterval = null;
  if (typeof req.on === "function") {
    req.on("aborted", () => {
      connectionClosed = true;
    });
  }
  if (typeof res.on === "function") {
    res.on("close", () => {
      connectionClosed = true;
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const emitProgress = (stage, payload = {}) => {
    const eventPayload = buildStatusPayload(requestId, stage, payload);
    if (typeof eventPayload.progress === "number") {
      latestProgress = eventPayload.progress;
    }
    sendSseEvent(res, "progress", eventPayload, connectionClosed);
  };

  const emitCompleted = (payload = {}) => {
    const eventPayload = buildStatusPayload(requestId, "response_dispatched", payload);
    if (typeof eventPayload.progress === "number") {
      latestProgress = eventPayload.progress;
    }
    sendSseEvent(res, "completed", eventPayload, connectionClosed);
  };

  const emitError = (error) => {
    sendSseEvent(
      res,
      "error",
      buildStatusPayload(requestId, "request_failed", {
        progress: latestProgress,
        message: error?.message ?? "Unexpected streaming error",
        error: error?.message ?? "Unexpected streaming error",
      }),
      connectionClosed
    );
  };

  const stopDeepAnalysisHeartbeat = () => {
    if (deepAnalysisInterval !== null) {
      clearInterval(deepAnalysisInterval);
      deepAnalysisInterval = null;
    }
  };

  const startDeepAnalysisHeartbeat = () => {
    let elapsedSeconds = 0;
    deepAnalysisInterval = setInterval(() => {
      elapsedSeconds += Math.round(DEEP_ANALYSIS_PROGRESS_INTERVAL_MS / 1000);
      const heartbeatProgress = Math.min(94, 80 + Math.ceil(elapsedSeconds / 4));
      emitProgress("deep_analysis_progress", {
        provider: "groq",
        elapsedSeconds,
        progress: heartbeatProgress,
        message: `Groq is analyzing baseline findings (${elapsedSeconds}s elapsed).`,
      });
    }, DEEP_ANALYSIS_PROGRESS_INTERVAL_MS);
    if (typeof deepAnalysisInterval.unref === "function") {
      deepAnalysisInterval.unref();
    }
  };

  try {
    emitProgress("request_received");

    const input = parseAllAuditsInput(req.body);
    baselineTotalCount =
      Array.isArray(input.types) && input.types.length > 0 ? input.types.length : 3;

    emitProgress("baseline_audit_started", {
      total: baselineTotalCount,
      message: `Running baseline audits (${baselineTotalCount} total).`,
    });

    const standardReport = await runAllAudits(input, {
      onAuditEvent(event) {
        if (event?.type === "audit_started") {
          baselineStartedCount += 1;
          const startedRatio = Math.min(
            1,
            baselineStartedCount / Math.max(1, baselineTotalCount)
          );
          const progressValue = 12 + Math.round(startedRatio * 18);
          emitProgress("baseline_audit_progress", {
            progress: progressValue,
            phase: "started",
            auditKey: event.auditKey,
            auditName: event.auditName,
            started: baselineStartedCount,
            total: baselineTotalCount,
            message: `${event.auditName ?? event.auditKey ?? "Audit"} started (${baselineStartedCount}/${baselineTotalCount}).`,
          });
          return;
        }

        if (event?.type !== "audit_completed" && event?.type !== "audit_failed") {
          return;
        }

        baselineCompletedCount += 1;
        const ratio = Math.min(1, baselineCompletedCount / Math.max(1, baselineTotalCount));
        const progressValue = 30 + Math.round(ratio * 40);
        const auditStatus = event?.result?.status ?? null;

        emitProgress("baseline_audit_progress", {
          progress: progressValue,
          phase: "completed",
          auditKey: event.auditKey,
          auditName: event.auditName,
          auditStatus,
          completed: baselineCompletedCount,
          total: baselineTotalCount,
          message: `${event.auditName ?? event.auditKey ?? "Audit"} completed with status ${auditStatus ?? "UNKNOWN"} (${baselineCompletedCount}/${baselineTotalCount}).`,
        });
      },
    });

    for (const audit of standardReport.audits ?? []) {
      emitProgress("audit_report", {
        auditKey: audit?.key ?? null,
        auditName: audit?.name ?? null,
        auditStatus: audit?.status ?? null,
        score: typeof audit?.details?.score === "number" ? audit.details.score : null,
        message: `${audit?.name ?? audit?.key ?? "Audit"} report ready (${audit?.status ?? "UNKNOWN"}).`,
      });
    }

    emitProgress("baseline_audit_completed", {
      progress: 70,
      summary: standardReport.summary,
      message: "Baseline audits completed. Evaluating deep analysis requirement.",
    });

    let aiAnalysis;
    if (shouldSkipDeepAnalysis(standardReport)) {
      emitProgress("deep_analysis_skipped", {
        progress: 90,
        provider: "groq",
        reason: "healthy_baseline_report",
      });
      aiAnalysis = createNominalDeepAnalysis();
    } else {
      emitProgress("deep_analysis_started", {
        progress: 80,
        provider: "groq",
        message: "Groq analysis started for baseline audit findings.",
      });
      startDeepAnalysisHeartbeat();
      try {
        aiAnalysis = await runDeepAudit(standardReport);
      } finally {
        stopDeepAnalysisHeartbeat();
      }
    }

    emitProgress("deep_analysis_completed", {
      progress: 95,
      agentStatus: aiAnalysis?.agent_status ?? "UNKNOWN",
      message: `Deep analysis completed with agent status: ${aiAnalysis?.agent_status ?? "UNKNOWN"}.`,
    });

    const responsePayload = {
      ...standardReport,
      deepAnalysis: aiAnalysis,
    };

    emitProgress("response_preparing", {
      progress: 98,
      message: "Audit execution finished. Preparing final response.",
    });

    emitCompleted({
      result: responsePayload,
    });

    if (!connectionClosed) {
      res.end();
    }
  } catch (error) {
    stopDeepAnalysisHeartbeat();
    if (!connectionClosed) {
      emitError(error);
      res.end();
      return;
    }

    next(error);
  }
}

function shouldSkipDeepAnalysis(report) {
  const overallScore = report?.summary?.overallScore;
  const errorCount = report?.summary?.errorCount ?? 0;
  return (
    typeof overallScore === "number" &&
    Number.isFinite(overallScore) &&
    overallScore >= 90 &&
    errorCount === 0
  );
}

function createNominalDeepAnalysis() {
  return {
    agent_status: "SYSTEM_NOMINAL",
    summary: "Core audit results are healthy. Deep analysis skipped for faster response.",
    steps: [],
  };
}

function buildStatusPayload(requestId, stage, payload = {}) {
  const template = STATUS_TEMPLATES[stage] ?? {};
  return {
    requestId,
    stage,
    status: template.status ?? "running",
    progress:
      typeof template.progress === "number" ? template.progress : null,
    message: template.message ?? stage,
    timestamp: new Date().toISOString(),
    ...payload,
  };
}

function sendSseEvent(res, eventName, payload, connectionClosed) {
  if (connectionClosed) {
    return;
  }

  const data = JSON.stringify(payload);
  res.write(`event: ${eventName}\ndata: ${data}\n\n`);
  if (typeof res.flush === "function") {
    res.flush();
  }
}

function buildCacheKey(scope, input) {
  return `${scope}:${JSON.stringify(input)}`;
}

function getCachedResponse(key) {
  if (!Number.isFinite(CACHE_TTL_MS) || CACHE_TTL_MS <= 0) {
    return null;
  }

  const cached = controllerResponseCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    controllerResponseCache.delete(key);
    return null;
  }

  return cached.payload;
}

function setCachedResponse(key, payload) {
  if (!Number.isFinite(CACHE_TTL_MS) || CACHE_TTL_MS <= 0) {
    return;
  }

  controllerResponseCache.set(key, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function __resetAuditControllerCache() {
  controllerResponseCache.clear();
}
