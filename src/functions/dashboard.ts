import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient, TableEntity } from "@azure/data-tables";
import { createLogger } from "../shared/logger.js";
import { ensureTable } from "../shared/job-tracker.js";
import { validateApiKey } from "../shared/auth.js";

const logger = createLogger("Dashboard");

interface DashboardStats {
  totalJobs: number;
  successCount: number;
  failureCount: number;
  noChangesCount: number;
  inProgressCount: number;
  recentJobs: Array<{
    workItemId: number;
    status: string;
    startedAt: string;
    completedAt?: string;
    prId?: number;
    retryCount?: number;
  }>;
}

async function handler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  logger.info("Dashboard request received");

  const authResult = validateApiKey(request, "DASHBOARD_API_KEY");
  if (authResult) return authResult;

  const connectionString = process.env["AzureWebJobsStorage"];
  if (!connectionString) {
    return {
      status: 503,
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
      recentJobs: [],
    };

    const allJobs: Array<{
      workItemId: number;
      status: string;
      startedAt: string;
      completedAt?: string;
      prId?: number;
      retryCount?: number;
    }> = [];

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

      allJobs.push({
        workItemId: parseInt(entity.rowKey as string, 10),
        status,
        startedAt: entity.startedAt as string,
        completedAt: entity.completedAt as string | undefined,
        prId: entity.prId as number | undefined,
        retryCount: entity.retryCount as number | undefined,
      });
    }

    // Sort by startedAt descending and take the 20 most recent
    allJobs.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    stats.recentJobs = allJobs.slice(0, 20);

    return {
      status: 200,
      jsonBody: stats,
    };
  } catch (error) {
    logger.error("Failed to fetch dashboard data", error instanceof Error ? error : undefined);
    return {
      status: 500,
      jsonBody: { error: "Failed to fetch dashboard data" },
    };
  }
}

app.http("dashboard", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler,
});

export { handler };
