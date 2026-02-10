const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export class InvalidUrlError extends Error {
  constructor(input) {
    super(`Invalid URL: ${input}`);
    this.name = "InvalidUrlError";
  }
}

export function assertValidUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new InvalidUrlError(input);
  }

  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    throw new InvalidUrlError(input);
  }

  return parsed.toString();
}

export function normalizeAuditTypes(typeArgs = [], defaults = []) {
  const normalized = typeArgs
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return [...defaults];
  }

  return [...new Set(normalized)];
}

