import { describe, expect, it } from "vitest";
import { AuditRegistry } from "../../src/core/engine/auditRegistry.js";

const perfAuditor = {
  key: "perf",
  name: "Performance Auditor",
  async run() {
    return {
      key: "perf",
      status: "PASS",
      details: {},
      logs: []
    };
  }
};

describe("AuditRegistry", () => {
  it("registers and resolves auditors", () => {
    const registry = new AuditRegistry();
    registry.register(perfAuditor);

    expect(registry.keys()).toEqual(["perf"]);
    expect(registry.get("perf")).toEqual(perfAuditor);
  });

  it("throws on duplicate keys", () => {
    const registry = new AuditRegistry();
    registry.register(perfAuditor);

    expect(() => registry.register(perfAuditor)).toThrow(/already registered/i);
  });
});
