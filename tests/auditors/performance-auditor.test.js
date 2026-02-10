import { describe, expect, it } from "vitest";
import { createPerformanceAuditor } from "../../src/core/auditors/performanceAuditor.js";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async json() {
      return payload;
    }
  };
}

describe("Performance Auditor", () => {
  it("uses PAGESPEEDINSIGHTS_API_KEY from environment when input key is missing", async () => {
    const previousKey = process.env.PAGESPEEDINSIGHTS_API_KEY;
    process.env.PAGESPEEDINSIGHTS_API_KEY = "env-test-key";

    let calledUrl = "";
    const auditor = createPerformanceAuditor({
      fetcher: async (url) => {
        calledUrl = url;
        return jsonResponse({
          loadingExperience: {
            metrics: {}
          }
        });
      }
    });

    await auditor.run({
      url: "https://example.com",
      timeoutMs: 5000
    });

    expect(calledUrl).toContain("key=env-test-key");
    process.env.PAGESPEEDINSIGHTS_API_KEY = previousKey;
  });

  it("extracts Core Web Vitals and classifies LCP errors", async () => {
    const auditor = createPerformanceAuditor({
      fetcher: async () =>
        jsonResponse({
          loadingExperience: {
            metrics: {
              LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100 },
              FIRST_INPUT_DELAY_MS: { percentile: 120 },
              CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 15 }
            }
          }
        })
    });

    const result = await auditor.run({
      url: "https://example.com",
      timeoutMs: 5000
    });

    expect(result.details.metrics.lcpMs).toBe(3100);
    expect(result.details.metrics.fidMs).toBe(120);
    expect(result.details.metrics.inpMs).toBeNull();
    expect(result.details.metrics.interactivity.metric).toBe("FID");
    expect(result.details.metrics.interactivity.valueMs).toBe(120);
    expect(result.details.metrics.cls).toBe(0.15);
    expect(result.details.scoring.outOf).toBe(100);
    expect(result.logs.some((entry) => entry.level === "ERROR" && /LCP > 2.5s/i.test(entry.message))).toBe(true);
  });

  it("warns when INP and FID are unavailable", async () => {
    const auditor = createPerformanceAuditor({
      fetcher: async () =>
        jsonResponse({
          loadingExperience: {
            metrics: {
              LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1800 },
              CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 3 }
            }
          }
        })
    });

    const result = await auditor.run({
      url: "https://example.com",
      timeoutMs: 5000
    });

    expect(result.details.metrics.fidMs).toBeNull();
    expect(result.details.metrics.inpMs).toBeNull();
    expect(result.details.metrics.interactivity.metric).toBe("UNAVAILABLE");
    expect(result.logs.some((entry) => entry.level === "WARNING" && /inp\/fid unavailable/i.test(entry.message))).toBe(
      true
    );
  });

  it("uses INP when available", async () => {
    const auditor = createPerformanceAuditor({
      fetcher: async () =>
        jsonResponse({
          loadingExperience: {
            metrics: {
              LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1700 },
              INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
              CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 4 }
            }
          }
        })
    });

    const result = await auditor.run({
      url: "https://example.com",
      timeoutMs: 5000
    });

    expect(result.details.metrics.inpMs).toBe(180);
    expect(result.details.metrics.fidMs).toBeUndefined();
    expect(result.details.metrics.interactivity.metric).toBe("INP");
    expect(result.details.metrics.interactivity.valueMs).toBe(180);
    expect(result.logs.some((entry) => entry.level === "INFO" && /INP is within target range/i.test(entry.message))).toBe(
      true
    );
  });

  it("throws a descriptive error for non-200 API responses", async () => {
    const auditor = createPerformanceAuditor({
      fetcher: async () => jsonResponse({ error: "fail" }, 404)
    });

    await expect(
      auditor.run({
        url: "https://example.com"
      })
    ).rejects.toThrow(/404/);
  });
});
