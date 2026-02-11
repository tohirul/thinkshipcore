import {
  BROKEN_STATUS_CODE_MAX,
  BROKEN_STATUS_CODE_MIN,
  HEAD_FALLBACK_STATUS_CODE,
  KNOWN_BOT_BLOCKERS,
  LINK_CHECK_CONCURRENCY,
  LINK_CHECK_GET_FALLBACK_TIMEOUT_MS,
  LINK_CHECK_TIMEOUT_MS,
  LINK_CHECK_USER_AGENT,
  PRIORITY,
  REDIRECT_STATUS_CODES,
} from "../../constants/seo.js";
import { fetchWithTimeout } from "../../utils/http.js";
import { isHttpUrl, normalizeWhitespace, safeResolveUrl } from "./shared.js";

const BOT_BLOCKER_STATUS_CODES = new Set([400, 403, 429, 999]);

function isProtectedDomain(url) {
  if (!url) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return KNOWN_BOT_BLOCKERS.has(hostname);
  } catch {
    return false;
  }
}

function analyzeLinks($, baseUrl) {
  const internal = new Set();
  const external = new Set();
  const ignored = [];
  const unresolved = [];
  const baseHost = isHttpUrl(baseUrl) ? new URL(baseUrl).hostname : null;

  $("a[href]").each((_, node) => {
    const href = normalizeWhitespace($(node).attr("href"));
    if (!href) {
      return;
    }

    const resolved = safeResolveUrl(href, baseUrl);
    if (!resolved) {
      unresolved.push(href);
      return;
    }

    if (!isHttpUrl(resolved)) {
      ignored.push(href);
      return;
    }

    const parsed = new URL(resolved);
    parsed.hash = "";
    const normalizedResolved = parsed.toString();

    if (baseHost && parsed.hostname === baseHost) {
      internal.add(normalizedResolved);
    } else {
      external.add(normalizedResolved);
    }
  });

  return {
    total: $("a").length,
    internalCount: internal.size,
    externalCount: external.size,
    internal: [...internal],
    external: [...external],
    unresolvedCount: unresolved.length,
    unresolved,
    ignoredCount: ignored.length,
  };
}

function isBrokenStatusCode(statusCode) {
  if (statusCode === 429) {
    return false;
  }

  return (
    Number.isInteger(statusCode) &&
    statusCode >= BROKEN_STATUS_CODE_MIN &&
    statusCode <= BROKEN_STATUS_CODE_MAX
  );
}

function buildLinkCandidates(links) {
  return [
    ...links.internal.map((url) => ({
      url,
      linkType: "internal",
      priority: PRIORITY.HIGH,
    })),
    ...links.external.map((url) => ({
      url,
      linkType: "external",
      priority: PRIORITY.MEDIUM,
    })),
  ];
}

function resolveLinkCheckTimeout(timeoutMs, fallbackTimeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fallbackTimeoutMs;
  }

  return Math.max(300, Math.min(timeoutMs, fallbackTimeoutMs));
}

function getLinkRequestOptions(method) {
  return {
    method,
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": LINK_CHECK_USER_AGENT,
    },
  };
}

function safeCancelResponseBody(response) {
  if (!response?.body || typeof response.body.cancel !== "function") {
    return;
  }

  try {
    response.body.cancel();
  } catch {
    // No-op: cancelling body is best-effort to free resources.
  }
}

function mapLinkCheckErrorCode(error) {
  const rawCode = String(error?.code ?? error?.cause?.code ?? "").toUpperCase();
  const message = normalizeWhitespace(error?.message ?? "");

  if (rawCode === "ECONNREFUSED" || /ECONNREFUSED/i.test(message)) {
    return "ECONNREFUSED";
  }

  if (
    rawCode === "ETIMEDOUT" ||
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    /ETIMEDOUT|timed out/i.test(message)
  ) {
    return "ETIMEDOUT";
  }

  if (
    /SSL|TLS|certificate|self signed|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(rawCode) ||
    /SSL|TLS|certificate|self signed|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(message)
  ) {
    return "SSL_ERROR";
  }

  if (rawCode) {
    return rawCode;
  }

  return "NETWORK_ERROR";
}

function createHealthyLinkResult(candidate, statusCode, location, checkedWith, usedFallback = false) {
  const isRedirect = REDIRECT_STATUS_CODES.has(statusCode);
  const isRateLimited = statusCode === 429;

  return {
    url: candidate.url,
    linkType: candidate.linkType,
    priority: candidate.priority,
    statusCode,
    checkedWith,
    usedFallback,
    isBroken: isBrokenStatusCode(statusCode),
    isRateLimited,
    isRedirect,
    location: isRedirect ? location : null,
    error: null,
  };
}

function createErroredLinkResult(candidate, error, checkedWith = "HEAD", usedFallback = false) {
  return {
    url: candidate.url,
    linkType: candidate.linkType,
    priority: candidate.priority,
    statusCode: mapLinkCheckErrorCode(error),
    checkedWith,
    usedFallback,
    isBroken: true,
    isRedirect: false,
    location: null,
    error: normalizeWhitespace(error?.message ?? "Link check failed"),
  };
}

async function requestLinkStatus(fetcher, url, method, timeoutMs) {
  const response = await fetchWithTimeout(fetcher, url, getLinkRequestOptions(method), timeoutMs);

  try {
    const locationHeader =
      typeof response?.headers?.get === "function" ? response.headers.get("location") : null;

    return {
      statusCode: response?.status,
      location: safeResolveUrl(locationHeader, url),
    };
  } finally {
    safeCancelResponseBody(response);
  }
}

async function checkLinkHealth(fetcher, candidate, timeoutMs) {
  const headTimeoutMs = resolveLinkCheckTimeout(timeoutMs, LINK_CHECK_TIMEOUT_MS);
  const protectedDomain = isProtectedDomain(candidate.url);

  try {
    const headResult = await requestLinkStatus(fetcher, candidate.url, "HEAD", headTimeoutMs);
    if (headResult.statusCode !== HEAD_FALLBACK_STATUS_CODE) {
      if (protectedDomain && BOT_BLOCKER_STATUS_CODES.has(headResult.statusCode)) {
        return {
          ...createHealthyLinkResult(candidate, headResult.statusCode, headResult.location, "HEAD"),
          isBroken: false,
          warning: `Bot protection detected (Status ${headResult.statusCode}). Validated manually.`,
        };
      }

      return createHealthyLinkResult(candidate, headResult.statusCode, headResult.location, "HEAD");
    }
  } catch (error) {
    return createErroredLinkResult(candidate, error, "HEAD");
  }

  const getTimeoutMs = resolveLinkCheckTimeout(timeoutMs, LINK_CHECK_GET_FALLBACK_TIMEOUT_MS);
  try {
    const getResult = await requestLinkStatus(fetcher, candidate.url, "GET", getTimeoutMs);
    if (protectedDomain && BOT_BLOCKER_STATUS_CODES.has(getResult.statusCode)) {
      return {
        ...createHealthyLinkResult(candidate, getResult.statusCode, getResult.location, "GET", true),
        isBroken: false,
        warning: `Bot protection detected (Status ${getResult.statusCode}). Validated manually.`,
      };
    }

    return createHealthyLinkResult(candidate, getResult.statusCode, getResult.location, "GET", true);
  } catch (error) {
    return createErroredLinkResult(candidate, error, "GET", true);
  }
}

async function mapWithConcurrency(items, concurrency, iterator) {
  if (items.length === 0) {
    return [];
  }

  const cappedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await iterator(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: cappedConcurrency }, () => worker()));
  return results;
}

async function analyzeLinkHealth(fetcher, links, timeoutMs) {
  const candidates = buildLinkCandidates(links);
  if (candidates.length === 0) {
    return {
      totalChecked: 0,
      brokenCount: 0,
      rateLimitedCount: 0,
      internalBrokenCount: 0,
      externalBrokenCount: 0,
      deadLinks: [],
      redirectCount: 0,
      redirects: [],
      warnings: [],
    };
  }

  const results = await mapWithConcurrency(candidates, LINK_CHECK_CONCURRENCY, (candidate) =>
    checkLinkHealth(fetcher, candidate, timeoutMs),
  );

  const deadLinks = [];
  const redirects = [];
  const warnings = [];
  let internalBrokenCount = 0;
  let externalBrokenCount = 0;
  let rateLimitedCount = 0;

  for (const result of results) {
    if (result.isRateLimited) {
      rateLimitedCount += 1;
    }

    if (result.warning) {
      warnings.push({
        url: result.url,
        message: result.warning,
      });
    }

    if (result.isBroken) {
      if (result.linkType === "internal") {
        internalBrokenCount += 1;
      } else {
        externalBrokenCount += 1;
      }

      const deadLink = {
        url: result.url,
        statusCode: result.statusCode,
        linkType: result.linkType,
        priority: result.priority,
      };

      if (result.error) {
        deadLink.error = result.error;
      }

      deadLinks.push(deadLink);
    }

    if (result.isRedirect) {
      redirects.push({
        url: result.url,
        statusCode: result.statusCode,
        linkType: result.linkType,
        location: result.location,
      });
    }
  }

  return {
    totalChecked: candidates.length,
    brokenCount: deadLinks.length,
    rateLimitedCount,
    internalBrokenCount,
    externalBrokenCount,
    deadLinks,
    redirectCount: redirects.length,
    redirects,
    warnings,
  };
}

export { analyzeLinkHealth, analyzeLinks };
