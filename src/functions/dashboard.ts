import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient, TableEntity } from "@azure/data-tables";
import { createLogger } from "../shared/logger.js";
import { ensureTable } from "../shared/job-tracker.js";
import { validateApiKey } from "../shared/auth.js";
import { JobRecord } from "../shared/types.js";
import { CORS_HEADERS, corsPreflightResponse } from "../shared/cors.js";

const logger = createLogger("Dashboard");

interface DashboardStats {
  totalJobs: number;
  successCount: number;
  failureCount: number;
  noChangesCount: number;
  inProgressCount: number;
  totalCostUsd: number;
  avgCostUsd: number;
  escalationCount: number;
  recentJobs: JobRecord[];
}

async function handler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse();
  }

  logger.info("Dashboard request received");

  const authResult = validateApiKey(request, "DASHBOARD_API_KEY");
  if (authResult) return { ...authResult, headers: { ...authResult.headers, ...CORS_HEADERS } };

  const connectionString = process.env["AzureWebJobsStorage"];
  if (!connectionString) {
    return {
      status: 503,
      headers: CORS_HEADERS,
      jsonBody: { error: "Storage not configured" },
    };
  }

  try {
    await ensureTable();
    const client = TableClient.fromConnectionString(connectionString, "bugfixjobs");

    const stats: DashboardStats = {
      totalJobs: 0,
      successCount: 0,
      failureCount: 0,
      noChangesCount: 0,
      inProgressCount: 0,
      totalCostUsd: 0,
      avgCostUsd: 0,
      escalationCount: 0,
      recentJobs: [],
    };

    const allJobs: JobRecord[] = [];
    let jobsWithCost = 0;

    for await (const entity of client.listEntities<TableEntity>({
      queryOptions: { filter: `PartitionKey eq 'jobs'` },
    })) {
      const status = entity.status as string;
      stats.totalJobs++;

      switch (status) {
        case "success":
          stats.successCount++;
          break;
        case "failure":
          stats.failureCount++;
          break;
        case "no-changes":
          stats.noChangesCount++;
          break;
        case "in-progress":
          stats.inProgressCount++;
          break;
      }

      const costUsd = entity.costUsd as number | undefined;
      if (costUsd !== undefined) {
        stats.totalCostUsd += costUsd;
        jobsWithCost++;
      }

      if (entity.escalated) {
        stats.escalationCount++;
      }

      allJobs.push({
        workItemId: parseInt(entity.rowKey as string, 10),
        status: status as JobRecord["status"],
        startedAt: entity.startedAt as string,
        completedAt: entity.completedAt as string | undefined,
        prId: entity.prId as number | undefined,
        retryCount: entity.retryCount as number | undefined,
        costUsd,
        durationMs: entity.durationMs as number | undefined,
        modelUsed: entity.modelUsed as string | undefined,
        escalated: entity.escalated as boolean | undefined,
        projectName: entity.projectName as string | undefined,
      });
    }

    stats.avgCostUsd = jobsWithCost > 0 ? stats.totalCostUsd / jobsWithCost : 0;

    // Sort by startedAt descending and take the 20 most recent
    allJobs.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    stats.recentJobs = allJobs.slice(0, 20);

    return {
      status: 200,
      headers: CORS_HEADERS,
      jsonBody: stats,
    };
  } catch (error) {
    logger.error("Failed to fetch dashboard data", error instanceof Error ? error : undefined);
    return {
      status: 500,
      headers: CORS_HEADERS,
      jsonBody: { error: "Failed to fetch dashboard data" },
    };
  }
}

app.http("dashboard", {
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler,
});

export { handler };
