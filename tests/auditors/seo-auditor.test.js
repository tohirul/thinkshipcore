import { describe, expect, it } from "vitest";
import { createSeoAuditor } from "../../src/core/auditors/seoAuditor.js";

function toHeaderMap(headers = {}) {
  const map = new Map();
  for (const [key, value] of Object.entries(headers)) {
    map.set(String(key).toLowerCase(), String(value));
  }
  return map;
}

function mockResponse({ body = "", status = 200, url = "https://example.com/", headers = {} } = {}) {
  const headerMap = toHeaderMap(headers);

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    url,
    headers: {
      get(name) {
        return headerMap.get(String(name).toLowerCase()) ?? null;
      },
    },
    body: {
      cancel() {
        return Promise.resolve();
      },
    },
    async text() {
      return body;
    },
  };
}

function htmlResponse(html, status = 200, url = "https://example.com/") {
  return mockResponse({ body: html, status, url });
}

function getHeader(headers, name) {
  if (!headers) {
    return null;
  }

  if (typeof headers.get === "function") {
    return headers.get(name) ?? headers.get(String(name).toLowerCase()) ?? null;
  }

  const lowerName = String(name).toLowerCase();
  const match = Object.entries(headers).find(([key]) => String(key).toLowerCase() === lowerName);
  return match?.[1] ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SEO Auditor", () => {
  it("reports deep SEO/content findings and categorizes links", async () => {
    const auditor = createSeoAuditor({
      fetcher: async () =>
        htmlResponse(`
          <html>
            <head>
              <title>Demo</title>
              <script type="application/ld+json">{bad-json}</script>
            </head>
            <body>
              <h2>Section</h2>
              <center>legacy</center>
              <img src="logo.png" />
              <a href="/about">About</a>
              <a href="https://external.test/path">External</a>
              <p>Short content sample.</p>
            </body>
          </html>
        `)
    });

    const result = await auditor.run({
      url: "https://example.com"
    });

    expect(result.details.metadata.missingRequiredMetaTags).toContain("description");
    expect(result.details.metadata.missingRequiredMetaTags).toContain("viewport");
    expect(result.details.metadata.missingRequiredLinkRels).toContain("canonical");
    expect(result.details.headings.h1Count).toBe(0);
    expect(result.details.headings.h2Count).toBe(1);
    expect(result.details.contentQuality.wordCount).toBeGreaterThan(0);
    expect(result.details.contentQuality.isThinContent).toBe(true);
    expect(result.details.structuredData.totalJsonLdScripts).toBe(1);
    expect(result.details.structuredData.invalidJsonLdScripts).toBe(1);
    expect(result.details.images.missingAltCount).toBe(1);
    expect(result.details.links.discovery.internalUrlCount).toBe(1);
    expect(result.details.links.discovery.externalUrlCount).toBe(1);
    expect(result.details.links.discovery.internalUrls).toContain("https://example.com/about");
    expect(result.details.links.discovery.externalUrls).toContain("https://external.test/path");
    expect(result.recommendations.some((entry) => entry.area === "Heading Hierarchy")).toBe(true);
    expect(result.logs.some((entry) => entry.level === "WARNING" && /legacy dom/i.test(entry.message))).toBe(true);
  });

  it("applies required score penalties for missing meta, missing h1, and invalid json-ld", async () => {
    const longText = Array.from({ length: 320 }, (_, index) => `word${index}`).join(" ");
    const auditor = createSeoAuditor({
      fetcher: async () =>
        htmlResponse(`
          <html>
            <head>
              <title>Demo</title>
              <link rel="canonical" href="https://example.com"/>
              <meta property="og:title" content="Example"/>
              <meta property="og:description" content="Example desc"/>
              <meta property="og:image" content="https://example.com/og.jpg"/>
              <meta property="og:url" content="https://example.com"/>
              <meta name="twitter:card" content="summary_large_image"/>
              <meta name="twitter:title" content="Example"/>
              <meta name="twitter:image" content="https://example.com/twitter.jpg"/>
              <script type="application/ld+json">{bad-json}</script>
            </head>
            <body>
              <h2>Section</h2>
              <p>${longText}</p>
            </body>
          </html>
        `)
    });

    const result = await auditor.run({
      url: "https://example.com"
    });

    expect(result.details.metadata.missingRequiredMetaTags).toEqual(["description", "viewport"]);
    expect(result.details.headings.h1Count).toBe(0);
    expect(result.details.structuredData.invalidJsonLdScripts).toBe(1);
    expect(result.score).toBe(59);
    expect(result.details.score).toBe(59);
    expect(result.logs.some((entry) => entry.level === "ERROR" && /invalid json-ld/i.test(entry.message))).toBe(true);
  });

  it("flags multiple h1 tags as low-priority heading issue", async () => {
    const auditor = createSeoAuditor({
      fetcher: async () =>
        htmlResponse(`
          <html>
            <head>
              <meta name="description" content="ok"/>
              <meta name="viewport" content="width=device-width, initial-scale=1"/>
              <link rel="canonical" href="https://example.com"/>
              <script type="application/ld+json">{ "ok": true }</script>
            </head>
            <body>
              <h1>Primary</h1>
              <h1>Duplicate</h1>
              <p>Content</p>
            </body>
          </html>
        `)
    });

    const result = await auditor.run({
      url: "https://example.com"
    });

    expect(result.details.headings.h1Count).toBe(2);
    expect(result.logs.some((entry) => /multiple h1/i.test(entry.message))).toBe(true);
    expect(
      result.recommendations.some(
        (entry) => entry.area === "Heading Hierarchy" && entry.priority === "LOW"
      )
    ).toBe(true);
  });

  it("throws a descriptive error for 404 responses", async () => {
    const auditor = createSeoAuditor({
      fetcher: async () => htmlResponse("<html/>", 404)
    });

    await expect(
      auditor.run({
        url: "https://example.com"
      })
    ).rejects.toThrow(/404/);
  });

  it("reports link health via HEAD checks, GET fallback, and redirects", async () => {
    const longText = Array.from({ length: 320 }, (_, index) => `word${index}`).join(" ");
    const calls = [];

    const auditor = createSeoAuditor({
      fetcher: async (url, options = {}) => {
        calls.push({
          url,
          method: options.method ?? "GET",
          userAgent: getHeader(options.headers, "user-agent"),
        });

        if (!options.method) {
          return htmlResponse(
            `
              <html>
                <head>
                  <meta name="description" content="ok"/>
                  <meta name="viewport" content="width=device-width, initial-scale=1"/>
                  <link rel="canonical" href="https://example.com"/>
                  <script type="application/ld+json">{ "ok": true }</script>
                </head>
                <body>
                  <h1>Primary</h1>
                  <a href="/internal-404">Internal 404</a>
                  <a href="https://external.test/down">External down</a>
                  <a href="/redirect-link">Redirect</a>
                  <a href="/head-rejected">HEAD rejected</a>
                  <p>${longText}</p>
                </body>
              </html>
            `,
            200,
            "https://example.com/"
          );
        }

        if (url === "https://example.com/internal-404" && options.method === "HEAD") {
          return mockResponse({ status: 404, url });
        }

        if (url === "https://external.test/down" && options.method === "HEAD") {
          return mockResponse({ status: 503, url });
        }

        if (url === "https://example.com/redirect-link" && options.method === "HEAD") {
          return mockResponse({ status: 301, url, headers: { location: "/new-home" } });
        }

        if (url === "https://example.com/head-rejected" && options.method === "HEAD") {
          return mockResponse({ status: 405, url });
        }

        if (url === "https://example.com/head-rejected" && options.method === "GET") {
          return mockResponse({ status: 200, url });
        }

        return mockResponse({ status: 200, url });
      },
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.links.health.checkedUrlCount).toBe(4);
    expect(result.details.links.health.brokenUrlCount).toBe(2);
    expect(result.details.links.health.brokenUrls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://example.com/internal-404", statusCode: 404 }),
        expect.objectContaining({ url: "https://external.test/down", statusCode: 503 }),
      ])
    );
    expect(result.details.links.health.redirectUrls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "https://example.com/redirect-link",
          statusCode: 301,
          targetUrl: "https://example.com/new-home",
        }),
      ])
    );
    expect(result.logs.some((entry) => /links are redirects/i.test(entry.message))).toBe(true);
    expect(
      result.recommendations.some((entry) => /fix internal redirect chains/i.test(entry.action))
    ).toBe(true);

    expect(
      calls.some(
        (call) =>
          call.url === "https://example.com/head-rejected" && call.method === "HEAD"
      )
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.url === "https://example.com/head-rejected" && call.method === "GET"
      )
    ).toBe(true);
    expect(
      calls
        .filter(
          (call) =>
            call.method === "HEAD" ||
            (call.method === "GET" && call.url === "https://example.com/head-rejected")
        )
        .every((call) => /mozilla/i.test(call.userAgent ?? ""))
    ).toBe(true);
  });

  it("deduplicates hash-fragment links and tracks 429 as rate-limited, not broken", async () => {
    const longText = Array.from({ length: 320 }, (_, index) => `word${index}`).join(" ");
    const calls = [];
    const auditor = createSeoAuditor({
      fetcher: async (url, options = {}) => {
        calls.push({
          url,
          method: options.method ?? "GET",
        });

        if (!options.method) {
          return htmlResponse(`
            <html>
              <head>
                <meta name="description" content="ok"/>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <link rel="canonical" href="https://example.com"/>
                <meta property="og:title" content="Example"/>
                <meta property="og:description" content="Example desc"/>
                <meta property="og:image" content="https://example.com/og.jpg"/>
                <meta property="og:url" content="https://example.com"/>
                <meta name="twitter:card" content="summary_large_image"/>
                <meta name="twitter:title" content="Example"/>
                <meta name="twitter:image" content="https://example.com/twitter.jpg"/>
                <script type="application/ld+json">{ "ok": true }</script>
              </head>
              <body>
                <h1>Primary</h1>
                <a href="/about#team">About Team</a>
                <a href="/about#contact">About Contact</a>
                <a href="/rate-limited">Rate limited</a>
                <p>${longText}</p>
              </body>
            </html>
          `);
        }

        if (url === "https://example.com/rate-limited" && options.method === "HEAD") {
          return mockResponse({ status: 429, url });
        }

        return mockResponse({ status: 200, url });
      },
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.links.health.checkedUrlCount).toBe(2);
    expect(result.details.links.health.brokenUrlCount).toBe(0);
    expect(result.details.links.health.rateLimitedUrlCount).toBe(1);
    expect(result.details.links.discovery.internalUrls).toContain("https://example.com/about");
    expect(result.logs.some((entry) => /rate-limited \(429\)/i.test(entry.message))).toBe(true);

    expect(
      calls.filter(
        (call) => call.url === "https://example.com/about" && call.method === "HEAD"
      )
    ).toHaveLength(1);
  });

  it("soft-fails known bot-blocking domains without counting them as broken", async () => {
    const longText = Array.from({ length: 320 }, (_, index) => `word${index}`).join(" ");
    const auditor = createSeoAuditor({
      fetcher: async (url, options = {}) => {
        if (!options.method) {
          return htmlResponse(`
            <html>
              <head>
                <meta name="description" content="ok"/>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <link rel="canonical" href="https://example.com"/>
                <meta property="og:title" content="Example"/>
                <meta property="og:description" content="Example desc"/>
                <meta property="og:image" content="https://example.com/og.jpg"/>
                <meta property="og:url" content="https://example.com"/>
                <meta name="twitter:card" content="summary_large_image"/>
                <meta name="twitter:title" content="Example"/>
                <meta name="twitter:image" content="https://example.com/twitter.jpg"/>
                <script type="application/ld+json">{ "ok": true }</script>
              </head>
              <body>
                <h1>Primary</h1>
                <a href="https://www.linkedin.com/company/example">LinkedIn</a>
                <p>${longText}</p>
              </body>
            </html>
          `);
        }

        if (url === "https://www.linkedin.com/company/example" && options.method === "HEAD") {
          return mockResponse({ status: 403, url });
        }

        return mockResponse({ status: 200, url });
      },
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.links.health.checkedUrlCount).toBe(1);
    expect(result.details.links.health.brokenUrlCount).toBe(0);
    expect(result.details.links.health.brokenExternalUrlCount).toBe(0);
    expect(result.details.links.health.warningUrlCount).toBe(1);
    expect(result.logs.some((entry) => /Skipped strict check for https:\/\/www\.linkedin\.com\/company\/example/i.test(entry.message))).toBe(
      true
    );
    expect(result.score).toBe(100);
  });

  it("caps link-health score deductions for internal and external broken links", async () => {
    const longText = Array.from({ length: 360 }, (_, index) => `word${index}`).join(" ");
    const internalLinks = Array.from(
      { length: 7 },
      (_, index) => `<a href="/internal-broken-${index}">Broken Internal ${index}</a>`
    ).join("\n");
    const externalLinks = Array.from(
      { length: 8 },
      (_, index) => `<a href="https://external.test/broken-${index}">Broken External ${index}</a>`
    ).join("\n");

    const auditor = createSeoAuditor({
      fetcher: async (url, options = {}) => {
        if (!options.method) {
          return htmlResponse(`
            <html>
              <head>
                <meta name="description" content="ok"/>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <link rel="canonical" href="https://example.com"/>
                <meta property="og:title" content="Example"/>
                <meta property="og:description" content="Example desc"/>
                <meta property="og:image" content="https://example.com/og.jpg"/>
                <meta property="og:url" content="https://example.com"/>
                <meta name="twitter:card" content="summary_large_image"/>
                <meta name="twitter:title" content="Example"/>
                <meta name="twitter:image" content="https://example.com/twitter.jpg"/>
                <script type="application/ld+json">{ "ok": true }</script>
              </head>
              <body>
                <h1>Primary</h1>
                ${internalLinks}
                ${externalLinks}
                <p>${longText}</p>
              </body>
            </html>
          `);
        }

        if (options.method === "HEAD") {
          return mockResponse({ status: 404, url });
        }

        return mockResponse({ status: 200, url });
      },
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.links.health.checkedUrlCount).toBe(15);
    expect(result.details.links.health.brokenInternalUrlCount).toBe(7);
    expect(result.details.links.health.brokenExternalUrlCount).toBe(8);
    expect(result.details.links.health.brokenUrlCount).toBe(15);
    expect(result.score).toBe(65);
    expect(result.details.score).toBe(65);
  });

  it("handles network/ssl errors during link checks without failing the audit", async () => {
    const longText = Array.from({ length: 320 }, (_, index) => `word${index}`).join(" ");
    const auditor = createSeoAuditor({
      fetcher: async (url, options = {}) => {
        if (!options.method) {
          return htmlResponse(`
            <html>
              <head>
                <meta name="description" content="ok"/>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <link rel="canonical" href="https://example.com"/>
                <script type="application/ld+json">{ "ok": true }</script>
              </head>
              <body>
                <h1>Primary</h1>
                <a href="/conn-refused">Refused</a>
                <a href="/ssl-issue">SSL</a>
                <p>${longText}</p>
              </body>
            </html>
          `);
        }

        if (url === "https://example.com/conn-refused" && options.method === "HEAD") {
          throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        }

        if (url === "https://example.com/ssl-issue" && options.method === "HEAD") {
          throw Object.assign(new Error("self signed certificate"), {
            code: "DEPTH_ZERO_SELF_SIGNED_CERT",
          });
        }

        return mockResponse({ status: 200, url });
      },
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.links.health.checkedUrlCount).toBe(2);
    expect(result.details.links.health.brokenUrlCount).toBe(2);
    expect(result.details.links.health.brokenUrls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://example.com/conn-refused", statusCode: "ECONNREFUSED" }),
        expect.objectContaining({ url: "https://example.com/ssl-issue", statusCode: "SSL_ERROR" }),
      ])
    );
    expect(result.status).toBe("FAIL");
  });

  it("limits concurrent link checks to five in-flight requests", async () => {
    const longText = Array.from({ length: 320 }, (_, index) => `word${index}`).join(" ");
    const linksHtml = Array.from(
      { length: 12 },
      (_, index) => `<a href="/link-${index}">Link ${index}</a>`
    ).join("\n");

    let inFlight = 0;
    let maxInFlight = 0;

    const auditor = createSeoAuditor({
      fetcher: async (url, options = {}) => {
        if (!options.method) {
          return htmlResponse(`
            <html>
              <head>
                <meta name="description" content="ok"/>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <link rel="canonical" href="https://example.com"/>
                <script type="application/ld+json">{ "ok": true }</script>
              </head>
              <body>
                <h1>Primary</h1>
                ${linksHtml}
                <p>${longText}</p>
              </body>
            </html>
          `);
        }

        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(5);
        inFlight -= 1;
        return mockResponse({ status: 200, url });
      },
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.links.health.checkedUrlCount).toBe(12);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("extracts top keywords with density and excludes common stop words", async () => {
    const longText = `${Array.from({ length: 320 }, () => "coffee").join(" ")} beans beans roast the and is on at which`;
    const auditor = createSeoAuditor({
      fetcher: async () =>
        htmlResponse(`
          <html>
            <head>
              <meta name="description" content="ok"/>
              <meta name="viewport" content="width=device-width, initial-scale=1"/>
              <link rel="canonical" href="https://example.com"/>
              <meta property="og:title" content="Example"/>
              <meta property="og:description" content="Example desc"/>
              <meta property="og:image" content="https://example.com/og.jpg"/>
              <meta property="og:url" content="https://example.com"/>
              <meta name="twitter:card" content="summary_large_image"/>
              <meta name="twitter:title" content="Example"/>
              <meta name="twitter:image" content="https://example.com/twitter.jpg"/>
              <script type="application/ld+json">{ "ok": true }</script>
            </head>
            <body>
              <h1>Coffee</h1>
              <p>${longText}</p>
            </body>
          </html>
        `),
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.contentRelevance.topKeywords.length).toBeGreaterThan(0);
    expect(result.details.contentRelevance.topKeywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ word: "coffee" }),
        expect.objectContaining({ word: "beans" }),
      ])
    );
    expect(
      result.details.contentRelevance.topKeywords.some((keyword) => keyword.word === "the")
    ).toBe(false);
    expect(
      result.details.contentRelevance.topKeywords.every((keyword) => /%$/.test(keyword.density))
    ).toBe(true);
  });

  it("reports social tag presence/missing and penalizes missing og:image", async () => {
    const longText = Array.from({ length: 320 }, (_, index) => `word${index}`).join(" ");
    const auditor = createSeoAuditor({
      fetcher: async () =>
        htmlResponse(`
          <html>
            <head>
              <meta name="description" content="ok"/>
              <meta name="viewport" content="width=device-width, initial-scale=1"/>
              <link rel="canonical" href="https://example.com"/>
              <meta property="og:description" content="Example desc"/>
              <meta property="og:url" content="https://example.com"/>
              <meta name="twitter:card" content="summary"/>
              <script type="application/ld+json">{ "ok": true }</script>
            </head>
            <body>
              <h1>Primary</h1>
              <p>${longText}</p>
            </body>
          </html>
        `),
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.social.openGraph.missingTags).toContain("og:image");
    expect(result.details.social.openGraph.missingTags).toContain("og:title");
    expect(result.details.social.twitter.presentTags).toContain("twitter:card");
    expect(result.details.social.twitter.missingTags).toEqual(
      expect.arrayContaining(["twitter:title", "twitter:image"])
    );
    expect(result.score).toBe(95);
    expect(
      result.recommendations.some(
        (entry) => entry.area === "Social Visibility" && /open graph/i.test(entry.action)
      )
    ).toBe(true);
  });

  it("adds a low-priority recommendation when no significant keywords are found", async () => {
    const stopWordHeavyText = Array.from({ length: 350 }, () => "the and is at which on").join(" ");
    const auditor = createSeoAuditor({
      fetcher: async () =>
        htmlResponse(`
          <html>
            <head>
              <meta name="description" content="ok"/>
              <meta name="viewport" content="width=device-width, initial-scale=1"/>
              <link rel="canonical" href="https://example.com"/>
              <meta property="og:title" content="Example"/>
              <meta property="og:description" content="Example desc"/>
              <meta property="og:image" content="https://example.com/og.jpg"/>
              <meta property="og:url" content="https://example.com"/>
              <meta name="twitter:card" content="summary_large_image"/>
              <meta name="twitter:title" content="Example"/>
              <meta name="twitter:image" content="https://example.com/twitter.jpg"/>
              <script type="application/ld+json">{ "ok": true }</script>
            </head>
            <body>
              <h1>The</h1>
              <p>${stopWordHeavyText}</p>
            </body>
          </html>
        `),
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.contentRelevance.topKeywords).toEqual([]);
    expect(
      result.recommendations.some(
        (entry) => entry.area === "Content Relevance" && entry.priority === "LOW"
      )
    ).toBe(true);
  });

  it("audits robots and sitemap crawlability with scoring penalties", async () => {
    const longText = Array.from({ length: 320 }, (_, index) => `word${index}`).join(" ");
    const auditor = createSeoAuditor({
      fetcher: async (url, options = {}) => {
        if (options.method === "HEAD") {
          return mockResponse({ status: 200, url });
        }

        if (url === "https://example.com/robots.txt") {
          return mockResponse({
            status: 200,
            url,
            body: "User-agent: *\nDisallow: /\n",
          });
        }

        if (url === "https://example.com/sitemap.xml") {
          return mockResponse({ status: 404, url, body: "Not found" });
        }

        return htmlResponse(`
          <html>
            <head>
              <meta name="description" content="ok"/>
              <meta name="viewport" content="width=device-width, initial-scale=1"/>
              <link rel="canonical" href="https://example.com"/>
              <meta property="og:title" content="Example"/>
              <meta property="og:description" content="Example desc"/>
              <meta property="og:image" content="https://example.com/og.jpg"/>
              <meta property="og:url" content="https://example.com"/>
              <meta name="twitter:card" content="summary_large_image"/>
              <meta name="twitter:title" content="Example"/>
              <meta name="twitter:image" content="https://example.com/twitter.jpg"/>
              <script type="application/ld+json">{ "ok": true }</script>
            </head>
            <body>
              <h1>Primary</h1>
              <p>${longText}</p>
            </body>
          </html>
        `);
      },
    });

    const result = await auditor.run({ url: "https://example.com" });

    expect(result.details.crawlability.robots.exists).toBe(true);
    expect(result.details.crawlability.robots.isBlockingRoot).toBe(true);
    expect(result.details.crawlability.sitemap.exists).toBe(false);
    expect(result.details.crawlability.sitemap.url).toBe("https://example.com/sitemap.xml");
    expect(result.details.crawlability.sitemap.pageCount).toBe(0);
    expect(result.score).toBe(75);
    expect(result.logs.some((entry) => /blocks the root path/i.test(entry.message))).toBe(true);
    expect(result.logs.some((entry) => /sitemap is missing/i.test(entry.message))).toBe(true);
    expect(
      result.recommendations.some(
        (entry) =>
          entry.area === "Crawlability" &&
          entry.priority === "HIGH" &&
          /disallow/i.test(entry.action)
      )
    ).toBe(true);
    expect(
      result.recommendations.some(
        (entry) =>
          entry.area === "Crawlability" &&
          entry.priority === "MEDIUM" &&
          /sitemap/i.test(entry.action)
      )
    ).toBe(true);
  });
});
