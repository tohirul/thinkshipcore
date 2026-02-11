import { HTTP_PROTOCOLS } from "../../constants/seo.js";

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeResolveUrl(rawUrl, baseUrl) {
  const candidate = normalizeWhitespace(rawUrl);
  if (!candidate || !baseUrl) {
    return null;
  }

  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

function isHttpUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return HTTP_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export { isHttpUrl, normalizeWhitespace, safeResolveUrl };
