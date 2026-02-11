import { assertValidUrl } from "../utils/url.js";

export async function runAudits(input, registry, options = {}) {
  const url = assertValidUrl(input.url);
  const startedAt = new Date().toISOString();
  const types = input.types ?? registry.keys();
  const onAuditEvent = typeof options.onAuditEvent === "function" ? options.onAuditEvent : null;
  const audits = await Promise.all(
    types.map((type) => {
      const auditor = registry.get(type);
      if (!auditor) {
        throw new Error(`Unknown audit type: ${type}`);
      }

      if (onAuditEvent) {
        onAuditEvent({
          type: "audit_started",
          auditKey: auditor.key,
          auditName: auditor.name
        });
      }

      return runAuditorSafely(auditor, {
        ...input,
        url
      }).then((result) => {
        if (onAuditEvent) {
          const completedType = result?.status === "FAIL" ? "audit_failed" : "audit_completed";
          onAuditEvent({
            type: completedType,
            auditKey: auditor.key,
            auditName: auditor.name,
            result
          });
        }

        return result;
      });
    })
  );

  const finishedAt = new Date().toISOString();
  return {
    url,
    startedAt,
    finishedAt,
    audits,
    summary: summarizeLogs(audits)
  };
}

function runAuditorSafely(auditor, input) {
  return auditor.run(input).catch((error) => ({
    key: auditor.key,
    name: auditor.name,
    status: "FAIL",
    details: {},
    logs: [
      {
        level: "ERROR",
        message: error?.message ?? "Unknown auditor error"
      }
    ]
  }));
}

function summarizeLogs(audits) {
  let infoCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  const findings = [];
  const scoreParts = [];

  for (const audit of audits) {
    const maybeScore = audit?.details?.score;
    if (typeof maybeScore === "number" && Number.isFinite(maybeScore)) {
      scoreParts.push(maybeScore);
    }

    for (const entry of audit.logs ?? []) {
      if (entry.level === "INFO") {
        infoCount += 1;
      } else if (entry.level === "WARNING") {
        warningCount += 1;
      } else if (entry.level === "ERROR") {
        errorCount += 1;
      }

      if (entry.level === "WARNING" || entry.level === "ERROR") {
        findings.push({
          level: entry.level,
          auditKey: audit.key,
          auditName: audit.name,
          message: entry.message
        });
      }
    }
  }

  findings.sort((a, b) => {
    if (a.level === b.level) return 0;
    return a.level === "ERROR" ? -1 : 1;
  });

  const overallScore =
    scoreParts.length === 0
      ? null
      : Math.round(scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length);

  return {
    totalAudits: audits.length,
    infoCount,
    warningCount,
    errorCount,
    overallScore,
    scoring: overallScore === null ? null : { score: overallScore, outOf: 100 },
    topFindings: findings.slice(0, 5)
  };
}
