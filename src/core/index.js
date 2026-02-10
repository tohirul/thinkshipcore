import { createPerformanceAuditor } from "./auditors/performanceAuditor.js";
import { createSeoAuditor } from "./auditors/seoAuditor.js";
import { createSecurityAuditor } from "./auditors/securityAuditor.js";
import { AuditRegistry } from "./engine/auditRegistry.js";
import { runAudits } from "./engine/auditRunner.js";
import { normalizeAuditTypes } from "./utils/url.js";

export { AuditRegistry, runAudits };
export { InvalidUrlError, assertValidUrl, normalizeAuditTypes } from "./utils/url.js";
export { HttpRequestError, TimeoutError } from "./utils/http.js";
export { LOG_LEVEL } from "./utils/logs.js";
export { createPerformanceAuditor, createSeoAuditor, createSecurityAuditor };

export function createDefaultRegistry({ fetcher = fetch } = {}) {
  const registry = new AuditRegistry();
  registry.register(createPerformanceAuditor({ fetcher }));
  registry.register(createSeoAuditor({ fetcher }));
  registry.register(createSecurityAuditor({ fetcher }));
  return registry;
}

export async function analyzeWebsite(input, options = {}) {
  const registry = options.registry ?? createDefaultRegistry({ fetcher: options.fetcher ?? fetch });
  const types = normalizeAuditTypes(input.types ?? [], registry.keys());
  return runAudits(
    {
      ...input,
      types
    },
    registry
  );
}

