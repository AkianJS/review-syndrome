import { HttpRequest, HttpResponseInit } from "@azure/functions";
import { timingSafeEqual } from "node:crypto";

/**
 * Validates the API key from the request against the expected value in an env var.
 * Returns null if auth passes, or an HttpResponseInit (401) if it fails.
 * Auth is skipped entirely if the env var is not set (backwards-compatible).
 */
export function validateApiKey(
  request: HttpRequest,
  envVarName: string
): HttpResponseInit | null {
  const expectedKey = process.env[envVarName];
  if (!expectedKey) {
    return null; // Auth disabled — env var not configured
  }

  const providedKey =
    request.headers.get("x-api-key") ??
    extractBearerToken(request.headers.get("authorization"));

  if (!providedKey) {
    return { status: 401, jsonBody: { error: "Unauthorized" } };
  }

  if (!safeEqual(providedKey, expectedKey)) {
    return { status: 401, jsonBody: { error: "Unauthorized" } };
  }

  return null;
}

function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Pad to same length to avoid leaking length info, then compare
    const maxLen = Math.max(bufA.length, bufB.length);
    const padA = Buffer.alloc(maxLen);
    const padB = Buffer.alloc(maxLen);
    bufA.copy(padA);
    bufB.copy(padB);
    timingSafeEqual(padA, padB);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
