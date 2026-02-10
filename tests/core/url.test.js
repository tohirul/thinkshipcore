import { describe, expect, it } from "vitest";
import { InvalidUrlError, assertValidUrl, normalizeAuditTypes } from "../../src/core/utils/url.js";

describe("assertValidUrl", () => {
  it("returns a normalized HTTPS URL", () => {
    expect(assertValidUrl("https://example.com")).toBe("https://example.com/");
  });

  it("throws InvalidUrlError for malformed URLs", () => {
    expect(() => assertValidUrl("not-a-url")).toThrowError(InvalidUrlError);
  });

  it("throws InvalidUrlError for non-http protocols", () => {
    expect(() => assertValidUrl("ftp://example.com")).toThrowError(InvalidUrlError);
  });
});

describe("normalizeAuditTypes", () => {
  it("normalizes comma-delimited values", () => {
    expect(normalizeAuditTypes(["perf,seo", "security"])).toEqual(["perf", "seo", "security"]);
  });

  it("defaults to all auditors when input is empty", () => {
    expect(normalizeAuditTypes([], ["perf", "seo"])).toEqual(["perf", "seo"]);
  });
});
