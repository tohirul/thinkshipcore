import * as cheerio from "cheerio";
import { deriveStatus, LOG_LEVEL } from "../utils/logs.js";
import { ensureOk, fetchWithTimeout } from "../utils/http.js";

const REQUIRED_META = ["description", "viewport"];
const REQUIRED_LINK_REL = ["canonical"];
const LEGACY_DOM_TAGS = ["center", "font", "marquee"];
const PRIORITY = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW"
};

function addRecommendation(recommendations, priority, area, action, impact) {
  recommendations.push({ priority, area, action, impact });
}

function calculateScore({ missingMetaTags, missingLinkRels, invalidJsonLdCount, withoutAlt, legacyTagsCount }) {
  let score = 100;
  score -= missingMetaTags.length * 8;
  score -= missingLinkRels.length * 8;
  score -= invalidJsonLdCount * 20;
  score -= Math.min(withoutAlt, 10) * 2;
  score -= legacyTagsCount * 4;
  return Math.max(0, score);
}

export function createSeoAuditor({ fetcher = fetch } = {}) {
  return {
    key: "seo",
    name: "SEO Auditor",
    async run({ url, timeoutMs = 0 }) {
      const response = await fetchWithTimeout(fetcher, url, {}, timeoutMs);
      ensureOk(response, "SEO fetch");
      const html = await response.text();
      const $ = cheerio.load(html);
      const logs = [];
      const recommendations = [];

      const missingMetaTags = REQUIRED_META.filter((name) => $(`meta[name="${name}"]`).length === 0);
      for (const meta of missingMetaTags) {
        logs.push({ level: LOG_LEVEL.WARNING, message: `Missing meta ${meta}` });
      }
      if (missingMetaTags.length > 0) {
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Meta Tags",
          "Add missing meta description and viewport tags.",
          "Improves search snippets and mobile rendering guidance."
        );
      }

      const missingLinkRels = REQUIRED_LINK_REL.filter((rel) => $(`link[rel="${rel}"]`).length === 0);
      for (const rel of missingLinkRels) {
        logs.push({ level: LOG_LEVEL.WARNING, message: `Missing link rel=${rel}` });
      }
      if (missingLinkRels.length > 0) {
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Canonical",
          "Define canonical URL to avoid duplicate-content ambiguity.",
          "Improves indexing consistency."
        );
      }

      let jsonLdCount = 0;
      let invalidJsonLdCount = 0;
      $('script[type="application/ld+json"]').each((_, node) => {
        jsonLdCount += 1;
        const raw = $(node).text();
        try {
          JSON.parse(raw);
        } catch {
          invalidJsonLdCount += 1;
        }
      });

      if (jsonLdCount === 0) {
        logs.push({ level: LOG_LEVEL.WARNING, message: "No JSON-LD schema found" });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Structured Data",
          "Add JSON-LD schema for key entities (Organization, WebSite, Breadcrumb, etc.).",
          "Improves rich result eligibility."
        );
      }
      if (invalidJsonLdCount > 0) {
        logs.push({ level: LOG_LEVEL.ERROR, message: "Invalid JSON-LD detected" });
        addRecommendation(
          recommendations,
          PRIORITY.HIGH,
          "Structured Data",
          "Fix invalid JSON-LD syntax and validate schema markup.",
          "Restores structured data visibility in search."
        );
      }

      const totalImages = $("img").length;
      const withoutAlt = $("img:not([alt]), img[alt='']").length;
      if (withoutAlt > 0) {
        logs.push({ level: LOG_LEVEL.WARNING, message: `${withoutAlt} image(s) missing alt attribute` });
        addRecommendation(
          recommendations,
          PRIORITY.LOW,
          "Accessibility/SEO",
          "Provide descriptive alt text for content images.",
          "Improves accessibility and image search relevance."
        );
      }

      const legacyTags = LEGACY_DOM_TAGS.filter((tag) => $(tag).length > 0);
      if (legacyTags.length > 0) {
        logs.push({ level: LOG_LEVEL.WARNING, message: "Legacy DOM detected" });
        addRecommendation(
          recommendations,
          PRIORITY.LOW,
          "Markup Quality",
          "Replace deprecated HTML tags with semantic modern markup and CSS.",
          "Improves maintainability and rendering consistency."
        );
      }

      if (logs.length === 0) {
        logs.push({ level: LOG_LEVEL.INFO, message: "No major SEO issues detected" });
      }

      const score = calculateScore({
        missingMetaTags,
        missingLinkRels,
        invalidJsonLdCount,
        withoutAlt,
        legacyTagsCount: legacyTags.length
      });

      return {
        key: "seo",
        name: "SEO Auditor",
        status: deriveStatus(logs),
        details: {
          missingMetaTags,
          missingLinkRels,
          jsonLd: {
            count: jsonLdCount,
            invalidCount: invalidJsonLdCount
          },
          images: {
            total: totalImages,
            withoutAlt
          },
          legacyDomTags: legacyTags,
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
