import { describe, expect, it } from "vitest";
import { AuditRegistry } from "../../src/core/engine/auditRegistry.js";
import { runAudits } from "../../src/core/engine/auditRunner.js";

const perfAuditor = {
  key: "perf",
  name: "Performance Auditor",
  async run() {
    return {
      key: "perf",
      name: "Performance Auditor",
      status: "FAIL",
      details: { metrics: { lcpMs: 3000 } },
      logs: [{ level: "ERROR", message: "LCP > 2.5s" }]
    };
  }
};

const seoAuditor = {
  key: "seo",
  name: "SEO Auditor",
  async run() {
    return {
      key: "seo",
      name: "SEO Auditor",
      status: "WARN",
      details: { missingMetaTags: ["description"] },
      logs: [{ level: "WARNING", message: "Missing meta description" }]
    };
  }
};

describe("runAudits", () => {
  it("runs selected audit types and returns a summary", async () => {
    const registry = new AuditRegistry();
    registry.register(perfAuditor);
    registry.register(seoAuditor);

    const report = await runAudits(
      {
        url: "https://example.com",
        types: ["perf"]
      },
      registry
    );

    expect(report.url).toBe("https://example.com/");
    expect(report.audits).toHaveLength(1);
    expect(report.audits[0].key).toBe("perf");
    expect(report.summary.errorCount).toBe(1);
    expect(report.summary.overallScore).toBeNull();
    expect(report.summary.scoring).toBeNull();
    expect(report.summary.topFindings[0].level).toBe("ERROR");
  });

  it("throws when an unknown audit is requested", async () => {
    const registry = new AuditRegistry();
    registry.register(perfAuditor);

    await expect(
      runAudits(
        {
          url: "https://example.com",
          types: ["unknown"]
        },
        registry
      )
    ).rejects.toThrow(/unknown audit type/i);
  });

  it("handles auditor failures gracefully", async () => {
    const registry = new AuditRegistry();
    registry.register({
      key: "security",
      name: "Security Auditor",
      async run() {
        throw new Error("404 Not Found");
      }
    });

    const report = await runAudits(
      {
        url: "https://example.com",
        types: ["security"]
      },
      registry
    );

    expect(report.audits[0].status).toBe("FAIL");
    expect(report.audits[0].logs[0].level).toBe("ERROR");
    expect(report.audits[0].logs[0].message).toMatch(/404/i);
  });

  it("computes summary scoring out of 100 from audit scores", async () => {
    const registry = new AuditRegistry();
    registry.register({
      key: "perf",
      name: "Performance Auditor",
      async run() {
        return {
          key: "perf",
          name: "Performance Auditor",
          status: "WARN",
          details: { score: 80 },
          logs: [{ level: "WARNING", message: "INP needs improvement" }]
        };
      }
    });
    registry.register({
      key: "seo",
      name: "SEO Auditor",
      async run() {
        return {
          key: "seo",
          name: "SEO Auditor",
          status: "PASS",
          details: { score: 100 },
          logs: [{ level: "INFO", message: "No major SEO issues detected" }]
        };
      }
    });

    const report = await runAudits(
      {
        url: "https://example.com",
        types: ["perf", "seo"]
      },
      registry
    );

    expect(report.summary.overallScore).toBe(90);
    expect(report.summary.scoring).toEqual({ score: 90, outOf: 100 });
  });

  it("runs multiple audits in parallel", async () => {
    const registry = new AuditRegistry();
    const executionOrder = [];
    let releasePerf;
    let releaseSeo;

    const perfGate = new Promise((resolve) => {
      releasePerf = resolve;
    });
    const seoGate = new Promise((resolve) => {
      releaseSeo = resolve;
    });

    registry.register({
      key: "perf",
      name: "Performance Auditor",
      async run() {
        executionOrder.push("perf:start");
        await perfGate;
        executionOrder.push("perf:end");
        return {
          key: "perf",
          name: "Performance Auditor",
          status: "PASS",
          details: { score: 100 },
          logs: [{ level: "INFO", message: "ok" }]
        };
      }
    });

    registry.register({
      key: "seo",
      name: "SEO Auditor",
      async run() {
        executionOrder.push("seo:start");
        await seoGate;
        executionOrder.push("seo:end");
        return {
          key: "seo",
          name: "SEO Auditor",
          status: "PASS",
          details: { score: 100 },
          logs: [{ level: "INFO", message: "ok" }]
        };
      }
    });

    const pending = runAudits(
      {
        url: "https://example.com",
        types: ["perf", "seo"]
      },
      registry
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executionOrder).toContain("perf:start");
    expect(executionOrder).toContain("seo:start");

    releasePerf();
    releaseSeo();

    const report = await pending;
    expect(report.audits).toHaveLength(2);
  });
});
