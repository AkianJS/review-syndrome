import { app, HttpRequest, HttpResponseInit, InvocationContext, output } from "@azure/functions";
import { PrRetryJob } from "../shared/types.js";
import { getJobRecord } from "../shared/job-tracker.js";
import { getBuildLog } from "../shared/azure-devops-client.js";
import { loadConfig } from "../shared/config.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("PrStatus");

const MAX_RETRY_COUNT = 2;

const retryQueueOutput = output.storageQueue({
  queueName: "pr-retry-jobs",
  connection: "AzureWebJobsStorage",
});

async function handler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  logger.info("Build status webhook received");

  let body: Record<string, any>;
  try {
    body = (await request.json()) as Record<string, any>;
  } catch {
    return { status: 400, body: "Invalid JSON body" };
  }

  const eventType = body.eventType;
  if (eventType !== "build.completed") {
    logger.info(`Ignoring event type: ${eventType}`);
    return { status: 200, body: "Event type not handled" };
  }

  const resource = body.resource ?? {};
  const buildResult = resource.result;

  // Only process failed builds
  if (buildResult !== "failed" && buildResult !== "partiallySucceeded") {
    logger.info(`Build result: ${buildResult}, no retry needed`);
    return { status: 200, body: "Build succeeded, no action needed" };
  }

  // Check if the build was triggered by a ReviewSyndrome PR branch
  const sourceBranch: string = resource.sourceBranch ?? "";
  if (!sourceBranch.includes("bugfix/wi-")) {
    logger.info(`Branch '${sourceBranch}' is not a ReviewSyndrome branch`);
    return { status: 200, body: "Not a ReviewSyndrome branch" };
  }

  // Extract work item ID from branch name: bugfix/wi-{id}-...
  const wiMatch = sourceBranch.match(/bugfix\/wi-(\d+)/);
  if (!wiMatch) {
    return { status: 200, body: "Could not extract work item ID from branch" };
  }
  const workItemId = parseInt(wiMatch[1], 10);

  // Check retry count
  const jobRecord = await getJobRecord(workItemId);
  const currentRetries = jobRecord?.retryCount ?? 0;
  if (currentRetries >= MAX_RETRY_COUNT) {
    logger.info(`Max retries (${MAX_RETRY_COUNT}) reached for WI #${workItemId}`, { workItemId });
    return {
      status: 200,
      body: JSON.stringify({ message: "Max retries reached", workItemId }),
    };
  }

  // Extract project and build info
  const projectName: string =
    resource.definition?.project?.name ??
    resource.project?.name ?? "";

  const buildId: number = resource.id;
  const repoId: string = resource.repository?.id ?? "";
  const repoUrl: string = resource.repository?.url ?? "";

  if (!projectName || !buildId) {
    return { status: 400, body: "Missing project name or build ID" };
  }

  // Fetch build failure log
  let ciFailureLog: string;
  try {
    const config = loadConfig(projectName);
    ciFailureLog = await getBuildLog(projectName, buildId, config);
  } catch (err) {
    logger.warn(`Could not fetch build log for build #${buildId}`, { buildId });
    ciFailureLog = `Build #${buildId} failed (could not retrieve detailed log)`;
  }

  const organizationUrl =
    process.env["AZURE_DEVOPS_ORG_URL"] ?? "";

  const branchName = sourceBranch.replace("refs/heads/", "");

  const retryJob: PrRetryJob = {
    workItemId,
    projectName,
    organizationUrl,
    prId: jobRecord?.prId ?? 0,
    branchName,
    repoId,
    repoUrl,
    ciFailureLog,
    retryCount: currentRetries + 1,
  };

  context.extraOutputs.set(retryQueueOutput, retryJob);

  logger.info(`Enqueued PR retry for WI #${workItemId}`, {
    workItemId,
    buildId,
    retryCount: retryJob.retryCount,
  });
  logger.trackEvent("pr_retry_enqueued", { workItemId, buildId, retryCount: retryJob.retryCount });

  return {
    status: 200,
    body: JSON.stringify({ message: "PR retry job enqueued", workItemId, retryCount: retryJob.retryCount }),
  };
}

app.http("pr-status-handler", {
  methods: ["POST"],
  authLevel: "anonymous",
  extraOutputs: [retryQueueOutput],
  handler,
});

export { handler };
