import { deriveStatus, LOG_LEVEL } from "../utils/logs.js";
import { ensureOk, fetchWithTimeout } from "../utils/http.js";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PRIORITY = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW"
};

function addRecommendation(recommendations, priority, area, action, impact) {
  recommendations.push({ priority, area, action, impact });
}

function calculateScore(logs) {
  let score = 100;
  for (const log of logs) {
    if (log.level === LOG_LEVEL.ERROR) {
      score -= 25;
    } else if (log.level === LOG_LEVEL.WARNING) {
      score -= 10;
    }
  }
  return Math.max(0, score);
}

function buildMetrics({ lcpMs, fidMs, inpMs, cls }) {
  const interactivity =
    inpMs !== null
      ? { metric: "INP", valueMs: inpMs }
      : fidMs !== null
        ? { metric: "FID", valueMs: fidMs }
        : { metric: "UNAVAILABLE", valueMs: null };

  return {
    lcpMs,
    ...(inpMs === null ? { fidMs } : {}),
    inpMs,
    cls,
    interactivity
  };
}

export function createPerformanceAuditor({ fetcher = fetch } = {}) {
  return {
    key: "perf",
    name: "Performance Auditor",
    async run({ url, pageSpeedApiKey, timeoutMs = 0 }) {
      const resolvedApiKey = pageSpeedApiKey ?? process.env.PAGESPEEDINSIGHTS_API_KEY;
      const endpoint = new URL(PSI_ENDPOINT);
      endpoint.searchParams.set("url", url);
      endpoint.searchParams.set("strategy", "mobile");
      if (resolvedApiKey) {
        endpoint.searchParams.set("key", resolvedApiKey);
      }

      const response = await fetchWithTimeout(fetcher, endpoint.toString(), {}, timeoutMs);
      ensureOk(response, "PageSpeed Insights request");
      const payload = await response.json();

      const metrics = payload?.loadingExperience?.metrics ?? {};
      const lcpMs = metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null;
      const fidMs = metrics.FIRST_INPUT_DELAY_MS?.percentile ?? null;
      const inpMs = metrics.INTERACTION_TO_NEXT_PAINT?.percentile ?? null;
      const clsRaw = metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile ?? null;
      const cls = clsRaw === null ? null : Number((clsRaw / 100).toFixed(3));

      const logs = [];
      const recommendations = [];
      if (lcpMs === null) {
        logs.push({ level: LOG_LEVEL.WARNING, message: "LCP unavailable from PSI response" });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "LCP",
          "Measure LCP in production and optimize critical rendering path.",
          "Improves user-perceived load speed."
        );
      } else if (lcpMs > 2500) {
        logs.push({ level: LOG_LEVEL.ERROR, message: "LCP > 2.5s" });
        addRecommendation(
          recommendations,
          PRIORITY.HIGH,
          "LCP",
          "Optimize hero image delivery, server response time, and render-blocking resources.",
          "Reduces bounce rate and improves Core Web Vitals compliance."
        );
      } else if (lcpMs > 2000) {
        logs.push({ level: LOG_LEVEL.WARNING, message: "LCP needs improvement" });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "LCP",
          "Preload above-the-fold assets and trim main-thread work during initial render.",
          "Helps reach good LCP threshold."
        );
      } else {
        logs.push({ level: LOG_LEVEL.INFO, message: "LCP is within target range" });
      }

      if (inpMs === null && fidMs === null) {
        logs.push({ level: LOG_LEVEL.WARNING, message: "INP/FID unavailable from PSI response" });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Interactivity",
          "Collect real-user interactivity data and reduce heavy JavaScript handlers.",
          "Improves responsiveness and reduces interaction delays."
        );
      } else if (inpMs !== null) {
        if (inpMs > 500) {
          logs.push({ level: LOG_LEVEL.ERROR, message: "INP > 500ms" });
          addRecommendation(
            recommendations,
            PRIORITY.HIGH,
            "INP",
            "Break up long tasks, defer non-critical scripts, and optimize event handlers.",
            "Improves responsiveness and user interaction quality."
          );
        } else if (inpMs > 200) {
          logs.push({ level: LOG_LEVEL.WARNING, message: "INP needs improvement" });
          addRecommendation(
            recommendations,
            PRIORITY.MEDIUM,
            "INP",
            "Reduce JavaScript execution and long main-thread tasks.",
            "Moves interactivity into the good range."
          );
        } else {
          logs.push({ level: LOG_LEVEL.INFO, message: "INP is within target range" });
        }
      } else {
        if (fidMs > 300) {
          logs.push({ level: LOG_LEVEL.ERROR, message: "FID > 300ms" });
          addRecommendation(
            recommendations,
            PRIORITY.HIGH,
            "FID",
            "Reduce blocking JavaScript and execution-heavy third-party scripts.",
            "Improves first interaction responsiveness."
          );
        } else if (fidMs > 100) {
          logs.push({ level: LOG_LEVEL.WARNING, message: "FID needs improvement" });
          addRecommendation(
            recommendations,
            PRIORITY.MEDIUM,
            "FID",
            "Trim script execution on first interaction path.",
            "Improves perceived responsiveness."
          );
        } else {
          logs.push({ level: LOG_LEVEL.INFO, message: "FID is within target range" });
        }
      }

      if (cls === null) {
        logs.push({ level: LOG_LEVEL.WARNING, message: "CLS unavailable from PSI response" });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "CLS",
          "Track layout shifts in production and reserve layout dimensions for dynamic content.",
          "Reduces visual instability."
        );
      } else if (cls > 0.25) {
        logs.push({ level: LOG_LEVEL.ERROR, message: "CLS > 0.25" });
        addRecommendation(
          recommendations,
          PRIORITY.HIGH,
          "CLS",
          "Set explicit width/height on media and avoid injecting content above existing elements.",
          "Prevents disruptive layout jumps."
        );
      } else if (cls > 0.1) {
        logs.push({ level: LOG_LEVEL.WARNING, message: "CLS needs improvement" });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "CLS",
          "Stabilize layout containers and preload critical fonts.",
          "Improves visual stability toward good threshold."
        );
      } else {
        logs.push({ level: LOG_LEVEL.INFO, message: "CLS is within target range" });
      }

      const score = calculateScore(logs);

      return {
        key: "perf",
        name: "Performance Auditor",
        status: deriveStatus(logs),
        details: {
          metrics: buildMetrics({ lcpMs, fidMs, inpMs, cls }),
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
