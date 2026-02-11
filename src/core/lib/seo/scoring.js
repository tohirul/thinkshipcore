import { SCORE_WEIGHTS } from "../../constants/seo.js";

function addRecommendation(recommendations, priority, area, action, impact) {
  recommendations.push({ priority, area, action, impact });
}

function calculateScore({
  missingMetaTags,
  missingLinkRels,
  hasMissingH1,
  hasMultipleH1,
  invalidJsonLdCount,
  isThinContent,
  withoutAlt,
  legacyTagsCount,
  internalBrokenCount,
  externalBrokenCount,
  hasMissingOgImage,
  hasBlockingRootRobots,
  hasMissingSitemap,
}) {
  let score = 100;
  score -= missingMetaTags.length * SCORE_WEIGHTS.MISSING_META;
  score -= missingLinkRels.length * SCORE_WEIGHTS.MISSING_CANONICAL;
  if (hasMissingH1) {
    score -= SCORE_WEIGHTS.MISSING_H1;
  }
  if (hasMultipleH1) {
    score -= SCORE_WEIGHTS.MULTIPLE_H1;
  }
  score -= invalidJsonLdCount * SCORE_WEIGHTS.INVALID_JSON_LD;
  if (isThinContent) {
    score -= SCORE_WEIGHTS.THIN_CONTENT;
  }
  score -= Math.min(withoutAlt, 10) * SCORE_WEIGHTS.MISSING_ALT;
  score -= legacyTagsCount * SCORE_WEIGHTS.LEGACY_TAG;
  score -= Math.min(
    internalBrokenCount * SCORE_WEIGHTS.INTERNAL_BROKEN_LINK,
    SCORE_WEIGHTS.INTERNAL_BROKEN_LINK_MAX,
  );
  score -= Math.min(
    externalBrokenCount * SCORE_WEIGHTS.EXTERNAL_BROKEN_LINK,
    SCORE_WEIGHTS.EXTERNAL_BROKEN_LINK_MAX,
  );
  if (hasMissingOgImage) {
    score -= SCORE_WEIGHTS.MISSING_OG_IMAGE;
  }
  if (hasBlockingRootRobots) {
    score -= SCORE_WEIGHTS.BLOCKING_ROOT_ROBOTS;
  }
  if (hasMissingSitemap) {
    score -= SCORE_WEIGHTS.MISSING_SITEMAP;
  }

  return Math.max(0, score);
}

export { addRecommendation, calculateScore };
