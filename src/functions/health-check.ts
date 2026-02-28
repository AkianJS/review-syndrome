import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

interface HealthCheckResult {
  status: "healthy" | "unhealthy";
  checks: Record<string, { status: "pass" | "fail"; message?: string }>;
}

async function handler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const result: HealthCheckResult = {
    status: "healthy",
    checks: {},
  };

  // Check required environment variables
  const requiredVars = ["AZURE_DEVOPS_ORG_URL", "AZURE_DEVOPS_PAT", "ANTHROPIC_API_KEY"];
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result, null, 2),
  };
}

app.http("health-check", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler,
});
