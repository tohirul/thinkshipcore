import { describe, expect, it } from "vitest";
import { fetchWithTimeout, TimeoutError } from "../../src/core/utils/http.js";

describe("fetchWithTimeout", () => {
  it("does not timeout when timeoutMs is 0", async () => {
    const response = { ok: true };
    const fetcher = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return response;
    };

    await expect(fetchWithTimeout(fetcher, "https://example.com", {}, 0)).resolves.toBe(response);
  });

  it("throws TimeoutError when request exceeds timeout", async () => {
    const fetcher = async (_url, options = {}) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true }), 40);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });

    await expect(fetchWithTimeout(fetcher, "https://example.com", {}, 5)).rejects.toBeInstanceOf(TimeoutError);
  });
});
