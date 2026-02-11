import * as cheerio from "cheerio";
import {
  LEGACY_DOM_TAGS,
  PRIORITY,
  REQUIRED_LINK_REL,
  REQUIRED_META,
  THIN_CONTENT_WORD_THRESHOLD,
} from "../constants/seo.js";
import {
  addRecommendation,
  analyzeLinkHealth,
  analyzeLinks,
  analyzeSocialTags,
  auditCrawlability,
  buildLinkRelSet,
  calculateScore,
  calculateTextToHtmlRatio,
  countImagesWithoutAlt,
  extractTopKeywords,
  findCanonicalUrl,
  getWordCount,
  normalizeWhitespace,
  safeResolveUrl,
} from "../lib/seo/index.js";
import { ensureOk, fetchWithTimeout } from "../utils/http.js";
import { deriveStatus, LOG_LEVEL } from "../utils/logs.js";

export function createSeoAuditor({ fetcher = fetch } = {}) {
  return {
    key: "seo",
    name: "SEO Auditor",
    async run({ url, timeoutMs = 0 }) {
      const response = await fetchWithTimeout(fetcher, url, {}, timeoutMs);
      ensureOk(response, "SEO fetch");
      const html = await response.text();
      const baseUrl = safeResolveUrl(url, response?.url ?? url) ?? safeResolveUrl(url, url);
      const $ = cheerio.load(html);
      const logs = [];
      const recommendations = [];

      const metaNames = new Set(
        $("meta[name]")
          .map((_, node) => normalizeWhitespace($(node).attr("name")).toLowerCase())
          .get(),
      );
      const missingMetaTags = REQUIRED_META.filter((name) => !metaNames.has(name));
      for (const meta of missingMetaTags) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: `Missing meta ${meta}`,
        });
      }
      if (missingMetaTags.length > 0) {
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Meta Tags",
          "Add missing meta description and viewport tags.",
          "Improves search snippets and mobile rendering guidance.",
        );
      }

      const relSet = buildLinkRelSet($);
      const missingLinkRels = REQUIRED_LINK_REL.filter((rel) => !relSet.has(rel));
      for (const rel of missingLinkRels) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: `Missing link rel=${rel}`,
        });
      }
      if (missingLinkRels.length > 0) {
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Canonical",
          "Define canonical URL to avoid duplicate-content ambiguity.",
          "Improves indexing consistency.",
        );
      }
      const canonicalUrl = findCanonicalUrl($, baseUrl);
      const social = analyzeSocialTags($);
      const crawlability = await auditCrawlability(fetcher, baseUrl, timeoutMs);

      if (social.hasMissingOgImage || social.hasMissingOgTitle) {
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Social Visibility",
          "Add Open Graph tags to improve social sharing previews.",
          "Improves social CTR by enabling rich preview cards.",
        );
      }

      if (!crawlability.robots.exists) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: "robots.txt is missing",
        });
      }

      if (crawlability.robots.isBlockingRoot) {
        logs.push({
          level: LOG_LEVEL.ERROR,
          message: "robots.txt blocks the root path with Disallow: /",
        });
        addRecommendation(
          recommendations,
          PRIORITY.HIGH,
          "Crawlability",
          "Remove root-level Disallow directives from robots.txt.",
          "Prevents accidental site-wide deindexing by search engine crawlers.",
        );
      }

      if (!crawlability.sitemap.exists) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: "Sitemap is missing or unreachable",
        });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Crawlability",
          "Publish a valid sitemap.xml and reference it in robots.txt.",
          "Improves URL discovery and crawl coverage.",
        );
      }

      const h1Count = $("h1").length;
      const h2Count = $("h2").length;
      if (h1Count === 0) {
        logs.push({
          level: LOG_LEVEL.ERROR,
          message: "Missing H1 heading",
        });
        addRecommendation(
          recommendations,
          PRIORITY.HIGH,
          "Heading Hierarchy",
          "Add exactly one descriptive H1 heading to the page.",
          "Strengthens topical clarity for search engines and users.",
        );
      } else if (h1Count > 1) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: `Multiple H1 tags detected (${h1Count})`,
        });
        addRecommendation(
          recommendations,
          PRIORITY.LOW,
          "Heading Hierarchy",
          "Keep a single primary H1 and move additional section titles to H2/H3.",
          "Improves semantic heading structure and crawl interpretation.",
        );
      }

      const bodyText = normalizeWhitespace($("body").text());
      const wordCount = getWordCount(bodyText);
      const textToHtmlRatio = calculateTextToHtmlRatio(bodyText, html);
      const isThinContent = wordCount < THIN_CONTENT_WORD_THRESHOLD;
      const keywordAnalysis = extractTopKeywords(bodyText, 5);
      if (isThinContent) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: `Thin content detected (${wordCount} words)`,
        });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Content Depth",
          `Expand primary content beyond ${THIN_CONTENT_WORD_THRESHOLD} words where relevant intent requires depth.`,
          "Improves relevance signals and potential ranking coverage.",
        );
      }

      if (keywordAnalysis.topKeywords.length === 0) {
        addRecommendation(
          recommendations,
          PRIORITY.LOW,
          "Content Relevance",
          "Add descriptive content.",
          "Helps search engines understand page topics and user intent.",
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
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: "No JSON-LD schema found",
        });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Structured Data",
          "Add JSON-LD schema for key entities (Organization, WebSite, Breadcrumb, etc.).",
          "Improves rich result eligibility.",
        );
      }
      if (invalidJsonLdCount > 0) {
        logs.push({
          level: LOG_LEVEL.ERROR,
          message: "Invalid JSON-LD detected",
        });
        addRecommendation(
          recommendations,
          PRIORITY.HIGH,
          "Structured Data",
          "Fix invalid JSON-LD syntax and validate schema markup.",
          "Restores structured data visibility in search.",
        );
      }

      const totalImages = $("img").length;
      const withoutAlt = countImagesWithoutAlt($);
      if (withoutAlt > 0) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: `${withoutAlt} image(s) missing alt attribute`,
        });
        addRecommendation(
          recommendations,
          PRIORITY.LOW,
          "Accessibility/SEO",
          "Provide descriptive alt text for content images.",
          "Improves accessibility and image search relevance.",
        );
      }

      const links = analyzeLinks($, baseUrl);
      const linkHealth = await analyzeLinkHealth(fetcher, links, timeoutMs);

      for (const warningEntry of linkHealth.warnings) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: `Skipped strict check for ${warningEntry.url}: ${warningEntry.message}`,
        });
      }

      if (linkHealth.internalBrokenCount > 0) {
        logs.push({
          level: LOG_LEVEL.ERROR,
          message: `${linkHealth.internalBrokenCount} broken internal link(s) detected`,
        });
        addRecommendation(
          recommendations,
          PRIORITY.HIGH,
          "Internal Links",
          "Fix or remove broken internal links returning 4xx/5xx or failing connectivity checks.",
          "Reduces crawl waste and prevents users from hitting dead pages.",
        );
      }

      if (linkHealth.externalBrokenCount > 0) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: `${linkHealth.externalBrokenCount} broken external link(s) detected`,
        });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "External Links",
          "Replace or remove broken external references to maintain outbound link quality.",
          "Preserves trust signals and prevents dead-end navigation.",
        );
      }

      if (linkHealth.rateLimitedCount > 0) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: `${linkHealth.rateLimitedCount} links were rate-limited (429). Decrease concurrency.`,
        });
      }

      if (linkHealth.redirectCount > 0) {
        logs.push({
          level: LOG_LEVEL.WARNING,
          message: `${linkHealth.redirectCount} links are redirects. Update them to the direct URL to save crawl budget.`,
        });
        addRecommendation(
          recommendations,
          PRIORITY.MEDIUM,
          "Redirect Hygiene",
          "Fix internal redirect chains.",
          "Prevents crawl-budget waste and improves crawl efficiency.",
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
          "Improves maintainability and rendering consistency.",
        );
      }

      if (logs.length === 0) {
        logs.push({
          level: LOG_LEVEL.INFO,
          message: "No major SEO issues detected",
        });
      }

      const score = calculateScore({
        missingMetaTags,
        missingLinkRels,
        hasMissingH1: h1Count === 0,
        hasMultipleH1: h1Count > 1,
        invalidJsonLdCount,
        isThinContent,
        withoutAlt,
        legacyTagsCount: legacyTags.length,
        internalBrokenCount: linkHealth.internalBrokenCount,
        externalBrokenCount: linkHealth.externalBrokenCount,
        hasMissingOgImage: social.hasMissingOgImage,
        hasBlockingRootRobots: crawlability.robots.isBlockingRoot,
        hasMissingSitemap: !crawlability.sitemap.exists,
      });
      const status = deriveStatus(logs);

      const brokenUrls = linkHealth.deadLinks.map((link) => {
        const entry = {
          url: link.url,
          statusCode: link.statusCode,
          category: link.linkType,
          priority: link.priority,
        };

        if (link.error) {
          entry.error = link.error;
        }

        return entry;
      });

      const redirectUrls = linkHealth.redirects.map((redirect) => ({
        url: redirect.url,
        statusCode: redirect.statusCode,
        category: redirect.linkType,
        targetUrl: redirect.location,
      }));

      return {
        key: "seo",
        name: "SEO Auditor",
        status,
        score,
        details: {
          summary: {
            status,
            score,
            outOf: 100,
          },
          metadata: {
            canonicalUrl,
            missingRequiredMetaTags: missingMetaTags,
            missingRequiredLinkRels: missingLinkRels,
          },
          headings: {
            h1Count: h1Count,
            h2Count: h2Count,
          },
          contentQuality: {
            wordCount,
            textToHtmlRatioPercent: textToHtmlRatio,
            isThinContent,
          },
          contentRelevance: {
            significantWordCount: keywordAnalysis.totalSignificantWords,
            topKeywords: keywordAnalysis.topKeywords,
          },
          social: {
            openGraph: {
              requiredTags: social.openGraph.requiredTags,
              presentTags: social.openGraph.presentTags,
              missingTags: social.openGraph.missingTags,
              tags: social.openGraph.tags,
            },
            twitter: {
              requiredTags: social.twitter.requiredTags,
              presentTags: social.twitter.presentTags,
              missingTags: social.twitter.missingTags,
              tags: social.twitter.tags,
            },
          },
          crawlability,
          links: {
            discovery: {
              totalAnchors: links.total,
              internalUrlCount: links.internalCount,
              externalUrlCount: links.externalCount,
              internalUrls: links.internal,
              externalUrls: links.external,
              unresolvedHrefCount: links.unresolvedCount,
              unresolvedHrefs: links.unresolved,
              ignoredHrefCount: links.ignoredCount,
            },
            health: {
              checkedUrlCount: linkHealth.totalChecked,
              brokenUrlCount: linkHealth.brokenCount,
              rateLimitedUrlCount: linkHealth.rateLimitedCount,
              warningUrlCount: linkHealth.warnings.length,
              brokenInternalUrlCount: linkHealth.internalBrokenCount,
              brokenExternalUrlCount: linkHealth.externalBrokenCount,
              brokenUrls,
              redirectUrlCount: linkHealth.redirectCount,
              redirectUrls,
            },
          },
          structuredData: {
            totalJsonLdScripts: jsonLdCount,
            invalidJsonLdScripts: invalidJsonLdCount,
            validJsonLdScripts: Math.max(0, jsonLdCount - invalidJsonLdCount),
          },
          images: {
            totalImageCount: totalImages,
            missingAltCount: withoutAlt,
          },
          markup: {
            deprecatedTags: legacyTags,
            deprecatedTagCount: legacyTags.length,
          },
          score,
          scoring: {
            score,
            outOf: 100,
          },
          recommendations,
        },
        recommendations,
        logs,
      };
    },
  };
}
