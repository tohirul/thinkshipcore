import { runDeepAudit } from "../../core/prompt/agent.js";
import { runAllAudits, runSingleAudit } from "../services/auditService.js";
import {
  parseAllAuditsInput,
  parseCommonAuditInput,
} from "../validation/auditInput.js";

const CACHE_TTL_MS = Number(process.env.AUDIT_CACHE_TTL_MS ?? "60000");
const controllerResponseCache = new Map();

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
