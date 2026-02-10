import { deriveStatus, LOG_LEVEL } from "../utils/logs.js";
import { ensureOk, fetchWithTimeout } from "../utils/http.js";

const REQUIRED_HEADERS = ["content-security-policy", "x-frame-options"];
const RECOMMENDED_HEADERS = ["x-content-type-options"];
const PRIORITY = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM"
};

function addRecommendation(recommendations, priority, area, action, impact) {
  recommendations.push({ priority, area, action, impact });
}

function calculateScore({ missingRequiredCount, missingRecommendedCount }) {
  let score = 100;
  score -= missingRequiredCount * 30;
  score -= missingRecommendedCount * 10;
  return Math.max(0, score);
}

export function createSecurityAuditor({ fetcher = fetch } = {}) {
  return {
    key: "security",
    name: "Security Auditor",
    async run({ url, timeoutMs = 0 }) {
      const response = await fetchWithTimeout(fetcher, url, { method: "GET" }, timeoutMs);
      ensureOk(response, "Security header check");

      const logs = [];
      const headers = {};
      const recommendations = [];
      let missingRequiredCount = 0;
      let missingRecommendedCount = 0;

      for (const header of REQUIRED_HEADERS) {
        const value = response.headers.get(header);
        headers[header] = value;
        if (!value) {
          missingRequiredCount += 1;
          logs.push({
            level: LOG_LEVEL.ERROR,
            message: `Missing required security header: ${header}`
          });
          addRecommendation(
            recommendations,
            PRIORITY.HIGH,
            "Security Headers",
            `Configure ${header} response header.`,
            "Strengthens browser-level protection against common web attacks."
          );
        }
      }

      for (const header of RECOMMENDED_HEADERS) {
        const value = response.headers.get(header);
        headers[header] = value;
        if (!value) {
          missingRecommendedCount += 1;
          logs.push({
            level: LOG_LEVEL.WARNING,
            message: `Missing recommended security header: ${header}`
          });
          addRecommendation(
            recommendations,
            PRIORITY.MEDIUM,
            "Security Hardening",
            `Add ${header} header.`,
            "Improves browser hardening and MIME sniffing protections."
          );
        }
      }

      if (!logs.some((entry) => entry.level === LOG_LEVEL.ERROR)) {
        logs.push({ level: LOG_LEVEL.INFO, message: "Security headers configured" });
      }

      const score = calculateScore({ missingRequiredCount, missingRecommendedCount });

      return {
        key: "security",
        name: "Security Auditor",
        status: deriveStatus(logs),
        details: {
          headers,
          score,
          scoring: {
            score,
            outOf: 100
          },
          recommendations
        },
        logs
      };
    }
  };
}
