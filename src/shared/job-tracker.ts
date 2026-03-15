import { TableClient, TableEntity, RestError } from "@azure/data-tables";
import { JobRecord } from "./types.js";

export interface JobCompletionDetails {
  prId?: number;
  costUsd?: number;
  durationMs?: number;
  modelUsed?: string;
  escalated?: boolean;
  projectName?: string;
}

const TABLE_NAME = "bugfixjobs";

function getTableClient(): TableClient {
  const connectionString = process.env["AzureWebJobsStorage"];
  if (!connectionString) {
    throw new Error("AzureWebJobsStorage connection string not configured");
  }
  return TableClient.fromConnectionString(connectionString, TABLE_NAME);
}

export async function ensureTable(): Promise<void> {
  const client = getTableClient();
  await client.createTable();
}

export async function isJobProcessed(workItemId: number): Promise<boolean> {
  const client = getTableClient();
  try {
    const entity = await client.getEntity<TableEntity>("jobs", String(workItemId));
    const status = entity.status as string;
    return status === "success" || status === "in-progress";
  } catch (err: any) {
    if (err.statusCode === 404) return false;
    throw err;
  }
}

export async function markJobStarted(workItemId: number): Promise<boolean> {
  const client = getTableClient();
  try {
    await client.createEntity({
      partitionKey: "jobs",
      rowKey: String(workItemId),
      status: "in-progress",
      startedAt: new Date().toISOString(),
    });
    return true;
  } catch (err: any) {
    // 409 Conflict = entity already exists
    if (err.statusCode === 409) return false;
    throw err;
  }
}

export async function markJobCompleted(
  workItemId: number,
  result: "success" | "failure" | "no-changes",
  details: JobCompletionDetails = {}
): Promise<void> {
  const client = getTableClient();
  const { prId, costUsd, durationMs, modelUsed, escalated, projectName } = details;
  await client.updateEntity(
    {
      partitionKey: "jobs",
      rowKey: String(workItemId),
      status: result,
      completedAt: new Date().toISOString(),
      ...(prId !== undefined ? { prId } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(modelUsed !== undefined ? { modelUsed } : {}),
      ...(escalated !== undefined ? { escalated } : {}),
      ...(projectName !== undefined ? { projectName } : {}),
    },
    "Merge"
  );
}

export async function resetJob(workItemId: number): Promise<void> {
  const client = getTableClient();
  try {
    await client.deleteEntity("jobs", String(workItemId));
  } catch (err: any) {
    if (err.statusCode === 404) return; // Already gone
    throw err;
  }
}

export async function getJobRecord(workItemId: number): Promise<JobRecord | undefined> {
  const client = getTableClient();
  try {
    const entity = await client.getEntity<TableEntity>("jobs", String(workItemId));
    return {
      workItemId,
      status: entity.status as JobRecord["status"],
      startedAt: entity.startedAt as string,
      completedAt: entity.completedAt as string | undefined,
      prId: entity.prId as number | undefined,
      retryCount: entity.retryCount as number | undefined,
      costUsd: entity.costUsd as number | undefined,
      durationMs: entity.durationMs as number | undefined,
      modelUsed: entity.modelUsed as string | undefined,
      escalated: entity.escalated as boolean | undefined,
      projectName: entity.projectName as string | undefined,
    };
  } catch (err: any) {
    if (err.statusCode === 404) return undefined;
    throw err;
  }
}

export async function incrementRetryCount(workItemId: number): Promise<number> {
  const client = getTableClient();
  const record = await getJobRecord(workItemId);
  const newCount = (record?.retryCount ?? 0) + 1;
  await client.updateEntity(
    {
      partitionKey: "jobs",
      rowKey: String(workItemId),
      retryCount: newCount,
    },
    "Merge"
  );
  return newCount;
}

export function createJobRecord(workItemId: number): JobRecord {
  return {
    workItemId,
    status: "in-progress",
    startedAt: new Date().toISOString(),
  };
}
