import { describe, expect, it } from "vitest";
import { createSecurityAuditor } from "../../src/core/auditors/securityAuditor.js";

function responseWithHeaders(headersMap, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      get(name) {
        return headersMap[name.toLowerCase()] ?? null;
      }
    }
  };
}

describe("Security Auditor", () => {
  it("fails when required security headers are missing", async () => {
    const auditor = createSecurityAuditor({
      fetcher: async () => responseWithHeaders({})
    });

    const result = await auditor.run({
      url: "https://example.com"
    });

    expect(result.status).toBe("FAIL");
    expect(result.details.headers["content-security-policy"]).toBeNull();
    expect(result.details.headers["x-frame-options"]).toBeNull();
    expect(result.logs.some((entry) => entry.level === "ERROR" && /content-security-policy/i.test(entry.message))).toBe(true);
  });

  it("passes when required headers are present", async () => {
    const auditor = createSecurityAuditor({
      fetcher: async () =>
        responseWithHeaders({
          "content-security-policy": "default-src 'self'",
          "x-frame-options": "DENY",
          "x-content-type-options": "nosniff"
        })
    });

    const result = await auditor.run({
      url: "https://example.com"
    });

    expect(result.status).toBe("PASS");
    expect(result.logs.some((entry) => entry.level === "ERROR")).toBe(false);
    expect(result.logs.some((entry) => entry.level === "INFO" && /headers configured/i.test(entry.message))).toBe(true);
  });

  it("throws a descriptive error for non-200 responses", async () => {
    const auditor = createSecurityAuditor({
      fetcher: async () => responseWithHeaders({}, 404)
    });

    await expect(
      auditor.run({
        url: "https://example.com"
      })
    ).rejects.toThrow(/404/);
  });
});
