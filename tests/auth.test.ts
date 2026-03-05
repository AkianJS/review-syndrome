import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpRequest } from "@azure/functions";
import { validateApiKey } from "../src/shared/auth.js";

function makeRequest(headers: Record<string, string> = {}): HttpRequest {
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
  } as unknown as HttpRequest;
}

describe("validateApiKey", () => {
  const ENV_VAR = "TEST_API_KEY";

  beforeEach(() => {
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it("should return null when env var is not set (auth skipped)", () => {
    const result = validateApiKey(makeRequest(), ENV_VAR);
    expect(result).toBeNull();
  });

  it("should return 401 when key is missing from request", () => {
    process.env[ENV_VAR] = "secret-key";
    const result = validateApiKey(makeRequest(), ENV_VAR);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    expect(result!.jsonBody).toEqual({ error: "Unauthorized" });
  });

  it("should return 401 when key is wrong", () => {
    process.env[ENV_VAR] = "secret-key";
    const result = validateApiKey(
      makeRequest({ "x-api-key": "wrong-key" }),
      ENV_VAR
    );
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("should return null when X-Api-Key matches", () => {
    process.env[ENV_VAR] = "secret-key";
    const result = validateApiKey(
      makeRequest({ "x-api-key": "secret-key" }),
      ENV_VAR
    );
    expect(result).toBeNull();
  });

  it("should return null when Authorization: Bearer matches", () => {
    process.env[ENV_VAR] = "secret-key";
    const result = validateApiKey(
      makeRequest({ authorization: "Bearer secret-key" }),
      ENV_VAR
    );
    expect(result).toBeNull();
  });

  it("should reject Authorization header without Bearer prefix", () => {
    process.env[ENV_VAR] = "secret-key";
    const result = validateApiKey(
      makeRequest({ authorization: "Basic secret-key" }),
      ENV_VAR
    );
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("should be case-sensitive for key comparison", () => {
    process.env[ENV_VAR] = "Secret-Key";
    const result = validateApiKey(
      makeRequest({ "x-api-key": "secret-key" }),
      ENV_VAR
    );
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("should prefer X-Api-Key over Authorization header", () => {
    process.env[ENV_VAR] = "correct-key";
    const result = validateApiKey(
      makeRequest({
        "x-api-key": "correct-key",
        authorization: "Bearer wrong-key",
      }),
      ENV_VAR
    );
    expect(result).toBeNull();
  });
});
