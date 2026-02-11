import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../../utils/http.js";
import { normalizeWhitespace, safeResolveUrl } from "./shared.js";

async function auditCrawlability(fetcher, baseUrl, timeoutMs) {
  let origin = null;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return {
      robots: {
        exists: false,
        isBlockingRoot: false,
        contentSnippet: "",
      },
      sitemap: {
        exists: false,
        url: "",
        pageCount: 0,
        error: "Invalid base URL",
      },
    };
  }

  const robotsUrl = `${origin}/robots.txt`;
  let sitemapUrl = `${origin}/sitemap.xml`;
  const result = {
    robots: {
      exists: false,
      isBlockingRoot: false,
      contentSnippet: "",
    },
    sitemap: {
      exists: false,
      url: sitemapUrl,
      pageCount: 0,
      error: null,
    },
  };

  try {
    const robotsResponse = await fetchWithTimeout(fetcher, robotsUrl, {}, timeoutMs);
    if (robotsResponse.ok) {
      const robotsContent = await robotsResponse.text();
      const normalizedRobots = normalizeWhitespace(robotsContent);
      const sitemapMatch = robotsContent.match(/^\s*Sitemap:\s*(\S+)/im);
      if (sitemapMatch?.[1]) {
        const resolvedSitemapUrl = safeResolveUrl(sitemapMatch[1], robotsUrl);
        if (resolvedSitemapUrl) {
          sitemapUrl = resolvedSitemapUrl;
        }
      }

      result.robots = {
        exists: true,
        isBlockingRoot: /(^|\n)\s*Disallow:\s*\/\s*(#.*)?($|\n)/i.test(robotsContent),
        contentSnippet: normalizedRobots.slice(0, 300),
      };
    }
  } catch {
    // Treat robots fetch errors as missing robots.txt.
  }

  result.sitemap.url = sitemapUrl;

  try {
    const sitemapResponse = await fetchWithTimeout(fetcher, sitemapUrl, {}, timeoutMs);
    if (!sitemapResponse.ok) {
      result.sitemap.error = `Sitemap request failed with status ${sitemapResponse.status}`;
      return result;
    }

    const sitemapXml = await sitemapResponse.text();

    try {
      const sitemapDoc = cheerio.load(sitemapXml, { xmlMode: true });
      result.sitemap.exists = true;
      result.sitemap.pageCount = sitemapDoc("loc").length;
      result.sitemap.error = null;
    } catch {
      result.sitemap.exists = false;
      result.sitemap.error = "Invalid XML";
    }
  } catch {
    result.sitemap.exists = false;
    result.sitemap.error = "Not found";
  }

  return result;
}

export { auditCrawlability };
