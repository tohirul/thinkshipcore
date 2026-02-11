import { STOP_WORDS } from "../../constants/seo.js";
import { normalizeWhitespace } from "./shared.js";

function getWordCount(text) {
  if (!text) {
    return 0;
  }

  return text.split(/\s+/).filter(Boolean).length;
}

function calculateTextToHtmlRatio(text, html) {
  const htmlLength = normalizeWhitespace(html).length;
  if (htmlLength === 0) {
    return 0;
  }

  const ratio = (text.length / htmlLength) * 100;
  return Number(ratio.toFixed(2));
}

function extractTopKeywords(text, topN = 5) {
  const normalizedText = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
  const tokens = normalizedText.split(/\s+/).filter(Boolean);

  const frequencies = new Map();
  let totalSignificantWords = 0;

  for (const token of tokens) {
    if (STOP_WORDS.has(token) || token.length < 2) {
      continue;
    }

    totalSignificantWords += 1;
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  if (totalSignificantWords === 0) {
    return {
      totalSignificantWords: 0,
      topKeywords: [],
    };
  }

  const topKeywords = [...frequencies.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) {
        return b[1] - a[1];
      }

      return a[0].localeCompare(b[0]);
    })
    .slice(0, topN)
    .map(([word, count]) => ({
      word,
      count,
      density: `${((count / totalSignificantWords) * 100).toFixed(1)}%`,
    }));

  return {
    totalSignificantWords,
    topKeywords,
  };
}

export { calculateTextToHtmlRatio, extractTopKeywords, getWordCount };
