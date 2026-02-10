import { describe, expect, it } from "vitest";
import { createSeoAuditor } from "../../src/core/auditors/seoAuditor.js";

function htmlResponse(html, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() {
      return html;
    }
  };
}

describe("SEO Auditor", () => {
  it("reports missing meta tags, missing alt attrs, and missing schema", async () => {
    const auditor = createSeoAuditor({
      fetcher: async () =>
        htmlResponse(`
          <html>
            <head>
              <title>Demo</title>
            </head>
            <body>
              <center>legacy</center>
              <img src="logo.png" />
            </body>
          </html>
        `)
    });

    const result = await auditor.run({
      url: "https://example.com"
    });

    expect(result.details.missingMetaTags).toContain("description");
    expect(result.details.missingMetaTags).toContain("viewport");
    expect(result.details.jsonLd.count).toBe(0);
    expect(result.details.images.withoutAlt).toBe(1);
    expect(result.logs.some((entry) => entry.level === "WARNING" && /legacy dom/i.test(entry.message))).toBe(true);
  });

  it("flags invalid JSON-LD as an error", async () => {
    const auditor = createSeoAuditor({
      fetcher: async () =>
        htmlResponse(`
          <html>
            <head>
              <title>Demo</title>
              <meta name="description" content="x"/>
              <meta name="viewport" content="width=device-width, initial-scale=1"/>
              <link rel="canonical" href="https://example.com"/>
              <script type="application/ld+json">{bad-json}</script>
            </head>
            <body></body>
          </html>
        `)
    });

    const result = await auditor.run({
      url: "https://example.com"
    });

    expect(result.details.jsonLd.invalidCount).toBe(1);
    expect(result.logs.some((entry) => entry.level === "ERROR" && /invalid json-ld/i.test(entry.message))).toBe(true);
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
});
