import { ValidationError } from "../errors.js";

function parseTimeout(timeoutMs) {
  if (timeoutMs === undefined || timeoutMs === null || timeoutMs === "") {
    return 0;
  }

  const parsed = Number(timeoutMs);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new ValidationError("timeoutMs must be a number >= 0");
  }

  return parsed;
}

export function parseCommonAuditInput(body = {}) {
  const url = body?.url;
  if (!url || typeof url !== "string") {
    throw new ValidationError("url is required and must be a string");
  }

  const timeoutMs = parseTimeout(body.timeoutMs);
  const pageSpeedApiKey =
    typeof body.pageSpeedApiKey === "string" && body.pageSpeedApiKey.trim()
      ? body.pageSpeedApiKey.trim()
      : undefined;

  return {
    url,
    timeoutMs,
    pageSpeedApiKey
  };
}

export function parseAllAuditsInput(body = {}) {
  const common = parseCommonAuditInput(body);
  const typesRaw = body.types;

  if (typesRaw === undefined) {
    return common;
  }

  if (!Array.isArray(typesRaw)) {
    throw new ValidationError("types must be an array when provided");
  }

  const types = typesRaw.map((type) => String(type).trim()).filter(Boolean);
  return {
    ...common,
    types
  };
}

