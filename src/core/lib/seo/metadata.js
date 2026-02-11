import { OPEN_GRAPH_TAGS, TWITTER_TAGS } from "../../constants/seo.js";
import { normalizeWhitespace, safeResolveUrl } from "./shared.js";

function getMetaTagContent($, tagName) {
  const selector = `meta[property="${tagName}"], meta[name="${tagName}"]`;
  const node = $(selector)
    .toArray()
    .find((item) => normalizeWhitespace($(item).attr("content")).length > 0);

  if (!node) {
    return null;
  }

  return normalizeWhitespace($(node).attr("content"));
}

function analyzeSocialTags($) {
  const openGraph = {
    requiredTags: OPEN_GRAPH_TAGS,
    presentTags: [],
    missingTags: [],
    tags: {},
  };
  const twitter = {
    requiredTags: TWITTER_TAGS,
    presentTags: [],
    missingTags: [],
    tags: {},
  };

  for (const tag of OPEN_GRAPH_TAGS) {
    const content = getMetaTagContent($, tag);
    const isPresent = Boolean(content);
    openGraph.tags[tag] = isPresent;
    if (isPresent) {
      openGraph.presentTags.push(tag);
    } else {
      openGraph.missingTags.push(tag);
    }
  }

  for (const tag of TWITTER_TAGS) {
    const content = getMetaTagContent($, tag);
    const isPresent = Boolean(content);
    twitter.tags[tag] = isPresent;
    if (isPresent) {
      twitter.presentTags.push(tag);
    } else {
      twitter.missingTags.push(tag);
    }
  }

  return {
    openGraph,
    twitter,
    hasMissingOgImage: openGraph.missingTags.includes("og:image"),
    hasMissingOgTitle: openGraph.missingTags.includes("og:title"),
  };
}

function buildLinkRelSet($) {
  const relTokens = $("link[rel]")
    .map((_, node) => normalizeWhitespace($(node).attr("rel")).toLowerCase())
    .get()
    .flatMap((value) => value.split(/\s+/).filter(Boolean));

  return new Set(relTokens);
}

function findCanonicalUrl($, baseUrl) {
  const canonicalNode = $("link[rel]")
    .toArray()
    .find((node) =>
      normalizeWhitespace($(node).attr("rel"))
        .toLowerCase()
        .split(/\s+/)
        .includes("canonical"),
    );

  if (!canonicalNode) {
    return null;
  }

  const href = $(canonicalNode).attr("href");
  return safeResolveUrl(href, baseUrl);
}

export { analyzeSocialTags, buildLinkRelSet, findCanonicalUrl };
