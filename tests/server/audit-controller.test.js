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
  analyzeDeep
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
});
