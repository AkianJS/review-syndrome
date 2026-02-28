import { describe, it, expect, vi } from "vitest";
import { withRetry, isRetryableHttpError, isRetryableGitError } from "../src/shared/retry.js";

describe("withRetry", () => {
  it("should return on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and succeed on second attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should throw after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 })
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should not retry when retryOn returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("not retryable"));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 10,
        retryOn: () => false,
      })
    ).rejects.toThrow("not retryable");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should only retry when retryOn returns true", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("retryable"))
      .mockRejectedValueOnce(new Error("retryable"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, {
      maxAttempts: 5,
      baseDelayMs: 10,
      maxDelayMs: 50,
      retryOn: (err) => err.message === "retryable",
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("isRetryableHttpError", () => {
  it("should return true for 429 rate limit", () => {
    expect(isRetryableHttpError(new Error("API error 429: too many requests"))).toBe(true);
  });

  it("should return true for 500 server error", () => {
    expect(isRetryableHttpError(new Error("API error 500: internal"))).toBe(true);
  });

  it("should return true for 502 bad gateway", () => {
    expect(isRetryableHttpError(new Error("API error 502"))).toBe(true);
  });

  it("should return true for 503 unavailable", () => {
    expect(isRetryableHttpError(new Error("API error 503"))).toBe(true);
  });

  it("should return true for connection errors", () => {
    expect(isRetryableHttpError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableHttpError(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("should return false for 400 client error", () => {
    expect(isRetryableHttpError(new Error("API error 400: bad request"))).toBe(false);
  });

  it("should return false for 401 unauthorized", () => {
    expect(isRetryableHttpError(new Error("API error 401: unauthorized"))).toBe(false);
  });
});

describe("isRetryableGitError", () => {
  it("should return true for connection errors", () => {
    expect(isRetryableGitError(new Error("Connection refused"))).toBe(true);
  });

  it("should return true for timeout errors", () => {
    expect(isRetryableGitError(new Error("Operation timed out"))).toBe(true);
  });

  it("should return true for network errors", () => {
    expect(isRetryableGitError(new Error("Network is unreachable"))).toBe(true);
  });

  it("should return true for DNS resolution errors", () => {
    expect(isRetryableGitError(new Error("Could not resolve host"))).toBe(true);
  });

  it("should return false for auth errors", () => {
    expect(isRetryableGitError(new Error("Authentication failed"))).toBe(false);
  });
});
