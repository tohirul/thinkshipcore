import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runAllAudits,
  runSingleAudit,
  runDeepAudit
} = vi.hoisted(() => ({
  runAllAudits: vi.fn(),
  runSingleAudit: vi.fn(),
  runDeepAudit: vi.fn()
}));

vi.mock("../../src/server/services/auditService.js", () => ({
  runAllAudits,
  runSingleAudit
}));

vi.mock("../../src/core/prompt/agent.js", () => ({
  runDeepAudit
}));

import {
  __resetAuditControllerCache,
  analyzeAll,
  analyzeDeep,
  analyzeDeepProgress
} from "../../src/server/controllers/auditController.js";

function createHttpMocks(body) {
  const req = { body };
  const res = {
    status: vi.fn(),
    json: vi.fn()
  };
  res.status.mockReturnValue(res);
  const next = vi.fn();
  return { req, res, next };
}

function createStreamMocks(body, options = {}) {
  const req = {
    body,
    on: vi.fn((event, handler) => {
      if (options.fireReqCloseImmediately && event === "close") {
        handler();
      }
      if (options.fireReqAbortedImmediately && event === "aborted") {
        handler();
      }
    })
  };
  const res = {
    on: vi.fn(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn()
  };
  const next = vi.fn();
  return { req, res, next };
}

function parseSseEvents(res) {
  return res.write.mock.calls
    .map((call) => String(call[0]))
    .map((chunk) => {
      const lines = chunk.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));
      const event = eventLine ? eventLine.replace("event: ", "").trim() : null;
      const payload = dataLine
        ? JSON.parse(dataLine.replace("data: ", ""))
        : null;
      return { event, payload };
    })
    .filter((entry) => entry.event !== null && entry.payload !== null);
}

describe("auditController performance helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAuditControllerCache();
  });

  it("caches analyzeAll responses for identical input", async () => {
    const report = {
      url: "https://example.com/",
      audits: [],
      summary: { overallScore: 100, errorCount: 0 }
    };
    runAllAudits.mockResolvedValue(report);

    const first = createHttpMocks({ url: "https://example.com" });
    await analyzeAll(first.req, first.res, first.next);

    const second = createHttpMocks({ url: "https://example.com" });
    await analyzeAll(second.req, second.res, second.next);

    expect(runAllAudits).toHaveBeenCalledTimes(1);
    expect(first.next).not.toHaveBeenCalled();
    expect(second.next).not.toHaveBeenCalled();
    expect(second.res.status).toHaveBeenCalledWith(200);
    expect(second.res.json).toHaveBeenCalledWith(report);
  });

  it("skips deep model call when standard report is already healthy", async () => {
    runAllAudits.mockResolvedValue({
      url: "https://example.com/",
      audits: [],
      summary: {
        overallScore: 96,
        errorCount: 0
      }
    });
    runDeepAudit.mockResolvedValue({
      agent_status: "CRITICAL_OPTIMIZATION_REQUIRED",
      summary: "should not be used",
      steps: [{ action: "X" }]
    });

    const { req, res, next } = createHttpMocks({ url: "https://example.com" });
    await analyzeDeep(req, res, next);

    expect(runDeepAudit).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        deepAnalysis: expect.objectContaining({
          agent_status: "SYSTEM_NOMINAL"
        })
      })
    );
  });

  it("caches analyzeDeep responses for repeated requests", async () => {
    runAllAudits.mockResolvedValue({
      url: "https://example.com/",
      audits: [],
      summary: {
        overallScore: 55,
        errorCount: 1
      }
    });
    runDeepAudit.mockResolvedValue({
      agent_status: "CRITICAL_OPTIMIZATION_REQUIRED",
      summary: "deep response",
      steps: []
    });

    const first = createHttpMocks({ url: "https://example.com" });
    await analyzeDeep(first.req, first.res, first.next);

    const second = createHttpMocks({ url: "https://example.com" });
    await analyzeDeep(second.req, second.res, second.next);

    expect(runAllAudits).toHaveBeenCalledTimes(1);
    expect(runDeepAudit).toHaveBeenCalledTimes(1);
    expect(second.next).not.toHaveBeenCalled();
    expect(second.res.status).toHaveBeenCalledWith(200);
    expect(second.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        deepAnalysis: expect.objectContaining({
          agent_status: "CRITICAL_OPTIMIZATION_REQUIRED"
        })
      })
    );
  });

  it("streams progress events while deep audit is running", async () => {
    runAllAudits.mockImplementation(async (_input, options = {}) => {
      options?.onAuditEvent?.({ type: "audit_started", auditKey: "perf", auditName: "Performance Auditor" });
      options?.onAuditEvent?.({ type: "audit_started", auditKey: "seo", auditName: "SEO Auditor" });
      options?.onAuditEvent?.({ type: "audit_started", auditKey: "security", auditName: "Security Auditor" });
      options?.onAuditEvent?.({
        type: "audit_completed",
        auditKey: "perf",
        auditName: "Performance Auditor",
        result: { status: "PASS" }
      });
      options?.onAuditEvent?.({
        type: "audit_completed",
        auditKey: "seo",
        auditName: "SEO Auditor",
        result: { status: "WARN" }
      });
      options?.onAuditEvent?.({
        type: "audit_completed",
        auditKey: "security",
        auditName: "Security Auditor",
        result: { status: "FAIL" }
      });

      return {
        url: "https://example.com/",
        audits: [
          { key: "perf", name: "Performance Auditor", status: "PASS", details: { score: 95 } },
          { key: "seo", name: "SEO Auditor", status: "WARN", details: { score: 70 } },
          { key: "security", name: "Security Auditor", status: "FAIL", details: { score: 30 } }
        ],
        summary: {
          overallScore: 40,
          errorCount: 2
        }
      };
    });
    runDeepAudit.mockResolvedValue({
      agent_status: "CRITICAL_OPTIMIZATION_REQUIRED",
      summary: "deep response",
      steps: []
    });

    const { req, res, next } = createStreamMocks({ url: "https://example.com" });
    await analyzeDeepProgress(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
    expect(runAllAudits).toHaveBeenCalledTimes(1);
    expect(runDeepAudit).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("event: progress")
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("baseline_audit_progress")
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("audit_report")
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("deep_analysis_started")
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("\"provider\":\"groq\"")
    );
    expect(res.write).toHaveBeenCalledWith(
      expect.stringContaining("event: completed")
    );

    const events = parseSseEvents(res);
    const progressEvents = events.filter((entry) => entry.event === "progress");
    const completedEvent = events.find((entry) => entry.event === "completed");
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(
      progressEvents.every(
        (entry) =>
          typeof entry.payload.message === "string" &&
          entry.payload.message.length > 0 &&
          typeof entry.payload.requestId === "string" &&
          entry.payload.requestId.length > 0
      )
    ).toBe(true);
    expect(completedEvent?.payload.stage).toBe("response_dispatched");
    expect(completedEvent?.payload.result).toBeTruthy();
    expect(res.end).toHaveBeenCalled();
  });

  it("streams nominal deep status without LLM call when report is healthy", async () => {
    runAllAudits.mockResolvedValue({
      url: "https://example.com/",
      audits: [],
      summary: {
        overallScore: 95,
        errorCount: 0
      }
    });

    const { req, res, next } = createStreamMocks({ url: "https://example.com" });
    await analyzeDeepProgress(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(runDeepAudit).not.toHaveBeenCalled();
    const events = parseSseEvents(res);
    const writes = events.map((entry) => JSON.stringify(entry.payload)).join("\n");
    expect(writes).toContain("SYSTEM_NOMINAL");
    expect(writes).toContain("deep_analysis_skipped");
    expect(
      events.some(
        (entry) =>
          entry.payload.stage === "deep_analysis_skipped" &&
          typeof entry.payload.message === "string" &&
          entry.payload.message.length > 0
      )
    ).toBe(true);
    expect(res.end).toHaveBeenCalled();
  });

  it("does not treat request close as stream close", async () => {
    runAllAudits.mockResolvedValue({
      url: "https://example.com/",
      audits: [
        { key: "perf", name: "Performance Auditor", status: "PASS", details: { score: 95 } },
        { key: "seo", name: "SEO Auditor", status: "WARN", details: { score: 70 } },
        { key: "security", name: "Security Auditor", status: "FAIL", details: { score: 30 } }
      ],
      summary: {
        overallScore: 40,
        errorCount: 2
      }
    });
    runDeepAudit.mockResolvedValue({
      agent_status: "CRITICAL_OPTIMIZATION_REQUIRED",
      summary: "deep response",
      steps: []
    });

    const { req, res, next } = createStreamMocks(
      { url: "https://example.com" },
      { fireReqCloseImmediately: true }
    );
    await analyzeDeepProgress(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const writes = res.write.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(writes).toContain("baseline_audit_completed");
    expect(writes).toContain("deep_analysis_started");
    expect(writes).toContain("event: completed");
    expect(writes).toContain("response_dispatched");
  });
});
