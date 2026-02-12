import { ensureOk, fetchWithTimeout } from "../utils/http.js";
import { deriveStatus, LOG_LEVEL } from "../utils/logs.js";

// expanded header lists
const REQUIRED_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
];

const RECOMMENDED_HEADERS = [
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

const INFO_LEAK_HEADERS = ["x-powered-by", "server"];

const PRIORITY = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

const SCORE_WEIGHTS = {
  MISSING_REQUIRED: 20,
  MISSING_RECOMMENDED: 10,
  INFO_LEAK: 5,
};

function addRecommendation(recommendations, priority, area, action, impact) {
  recommendations.push({ priority, area, action, impact });
}

function calculateScore({
  missingRequiredCount,
  missingRecommendedCount,
  leakCount,
}) {
  let score = 100;
  score -= missingRequiredCount * SCORE_WEIGHTS.MISSING_REQUIRED;
  score -= missingRecommendedCount * SCORE_WEIGHTS.MISSING_RECOMMENDED;
  score -= leakCount * SCORE_WEIGHTS.INFO_LEAK;
  return Math.max(0, score);
}

export function createSecurityAuditor({ fetcher = fetch } = {}) {
  return {
    key: "security",
    name: "Security Auditor",
    async run({ url, timeoutMs = 0 }) {
      const response = await fetchWithTimeout(
        fetcher,
        url,
        { method: "GET" },
        timeoutMs,
      );
      ensureOk(response, "Security header check");

      const logs = [];
      const headers = {};
      const recommendations = [];
      const missingHeaders = [];
      const leakedInfo = [];

      let missingRequiredCount = 0;
      let missingRecommendedCount = 0;

      // 1. Critical Header Check
      for (const header of REQUIRED_HEADERS) {
        const value = response.headers.get(header);
        headers[header] = value || null;

        if (!value) {
          missingRequiredCount += 1;
          missingHeaders.push(header);
          logs.push({
            level: LOG_LEVEL.ERROR,
            message: `Missing critical security header: ${header}`,
          });

          // Specific advice for HSTS vs CSP
          const action =
            header === "strict-transport-security"
              ? "Enable HSTS with a max-age of at least 1 year (31536000)."
              : "Define a Content Security Policy (CSP) to prevent XSS.";

          addRecommendation(
            recommendations,
            PRIORITY.HIGH,
            "Critical Security",
            action,
            "Prevents man-in-the-middle attacks and cross-site scripting.",
          );
        } else if (
          header === "strict-transport-security" &&
          !value.includes("max-age")
        ) {
          // HSTS exists but is invalid
          logs.push({
            level: LOG_LEVEL.WARNING,
            message: "HSTS header found but missing max-age directive",
          });
        }
      }

      // 2. Recommended Header Check
      for (const header of RECOMMENDED_HEADERS) {
        const value = response.headers.get(header);
        headers[header] = value || null;

        if (!value) {
          missingRecommendedCount += 1;
          missingHeaders.push(header);
          logs.push({
            level: LOG_LEVEL.WARNING,
            message: `Missing recommended security header: ${header}`,
          });
          addRecommendation(
            recommendations,
            PRIORITY.MEDIUM,
            "Hardening",
            `Configure the ${header} header.`,
            "Reduces attack surface against clickjacking and MIME sniffing.",
          );
        }
      }

      // 3. Information Leak Check (Negative Check)
      let leakCount = 0;
      for (const header of INFO_LEAK_HEADERS) {
        const value = response.headers.get(header);
        if (value) {
          headers[header] = value;
          // We punish X-Powered-By specifically, as it's purely informational for hackers
          if (header === "x-powered-by") {
            leakCount += 1;
            leakedInfo.push({ header, value });
            logs.push({
              level: LOG_LEVEL.WARNING,
              message: `Server information leak detected: ${header} = ${value}`,
            });
            addRecommendation(
              recommendations,
              PRIORITY.LOW,
              "Information Disclosure",
              `Remove or obfuscate the ${header} header.`,
              "Hides your technology stack (e.g. Express/PHP) from automated scanners.",
            );
          }
          // For 'Server', we just log it as info usually, unless specific version is exposed
          else if (header === "server" && /\d/.test(value)) {
            // If it contains numbers (versions), warn about it
            logs.push({
              level: LOG_LEVEL.INFO,
              message: `Server header exposes version: ${value}`,
            });
          }
        }
      }

      if (logs.length === 0) {
        logs.push({
          level: LOG_LEVEL.INFO,
          message: "Security headers configured correctly",
        });
      }

      const score = calculateScore({
        missingRequiredCount,
        missingRecommendedCount,
        leakCount,
      });

      return {
        key: "security",
        name: "Security Auditor",
        status: deriveStatus(logs),
        details: {
          headers,
          missingHeaders,
          leakedInfo,
          score,
          scoring: {
            score,
            outOf: 100,
          },
          recommendations,
        },
        logs,
      };
    },
  };
}
