export class HttpRequestError extends Error {
  constructor(message, statusCode = null) {
    super(message);
    this.name = "HttpRequestError";
    this.statusCode = statusCode;
  }
}

export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function fetchWithTimeout(fetcher, url, options = {}, timeoutMs = 15000) {
  if (!timeoutMs || timeoutMs <= 0) {
    return fetcher(url, options);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function ensureOk(response, context) {
  if (response.ok) {
    return response;
  }

  throw new HttpRequestError(
    `${context} failed with status ${response.status} ${response.statusText ?? ""}`.trim(),
    response.status
  );
}
