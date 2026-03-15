import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { validateApiKey } from "../shared/auth.js";
import { CORS_HEADERS, corsPreflightResponse } from "../shared/cors.js";

interface HealthCheckResult {
  status: "healthy" | "unhealthy";
  checks: Record<string, { status: "pass" | "fail"; message?: string }>;
}

async function handler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse();
  }

  const authResult = validateApiKey(request, "DASHBOARD_API_KEY");
  if (authResult) return { ...authResult, headers: { ...authResult.headers, ...CORS_HEADERS } };

  const result: HealthCheckResult = {
    status: "healthy",
    checks: {},
  };

  // Check required environment variables
  const requiredVars = ["AZURE_DEVOPS_ORG_URL", "AZURE_DEVOPS_PAT", "ANTHROPIC_API_KEY", "WEBHOOK_API_KEY"];
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (value && value.length > 0) {
      result.checks[varName] = { status: "pass" };
    } else {
      result.checks[varName] = { status: "fail", message: "Not configured" };
      result.status = "unhealthy";
    }
  }

  // Check Azure Storage connection
  const storageConn = process.env["AzureWebJobsStorage"];
  if (storageConn && storageConn.length > 0 && storageConn !== "UseDevelopmentStorage=true") {
    result.checks["AzureStorage"] = { status: "pass" };
  } else if (storageConn === "UseDevelopmentStorage=true") {
    result.checks["AzureStorage"] = { status: "pass", message: "Using development storage" };
  } else {
    result.checks["AzureStorage"] = { status: "fail", message: "Not configured" };
    result.status = "unhealthy";
  }

  const statusCode = result.status === "healthy" ? 200 : 503;

  return {
    status: statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(result, null, 2),
  };
}

app.http("health-check", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler,
});

export { handler };
