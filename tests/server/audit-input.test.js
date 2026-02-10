import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/server/errors.js";
import { parseAllAuditsInput, parseCommonAuditInput } from "../../src/server/validation/auditInput.js";

describe("parseCommonAuditInput", () => {
  it("parses required fields and defaults timeoutMs to 0", () => {
    const parsed = parseCommonAuditInput({ url: "https://example.com" });
    expect(parsed).toEqual({
      url: "https://example.com",
      timeoutMs: 0,
      pageSpeedApiKey: undefined
    });
  });

  it("throws for invalid timeoutMs", () => {
    expect(() => parseCommonAuditInput({ url: "https://example.com", timeoutMs: -1 })).toThrow(ValidationError);
  });
});

describe("parseAllAuditsInput", () => {
  it("accepts custom types array", () => {
    const parsed = parseAllAuditsInput({
      url: "https://example.com",
      types: ["perf", "seo"]
    });

    expect(parsed.types).toEqual(["perf", "seo"]);
  });

  it("throws when types is not an array", () => {
    expect(() =>
      parseAllAuditsInput({
        url: "https://example.com",
        types: "perf"
      })
    ).toThrow(ValidationError);
  });
});

