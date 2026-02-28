import { app, InvocationContext } from "@azure/functions";
import { BugFixJob } from "../shared/types.js";
import { loadConfig } from "../shared/config.js";
import { processBugFixJob } from "../shared/pipeline.js";
import { ensureTable } from "../shared/job-tracker.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("Worker");

async function handler(
  message: unknown,
  context: InvocationContext
): Promise<void> {
  const job = (typeof message === "string" ? JSON.parse(message) : message) as BugFixJob;

  logger.info(`Processing bug fix job`, {
    workItemId: job.workItemId,
    projectName: job.projectName,
    step: "dequeue",
  });

  try {
    // Ensure idempotency table exists
    await ensureTable();

    const config = loadConfig(job.projectName);
    await processBugFixJob(job, config);

    logger.info(`Successfully processed bug fix job`, {
      workItemId: job.workItemId,
      projectName: job.projectName,
      step: "complete",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to process bug fix job`,
      error instanceof Error ? error : undefined,
      {
        workItemId: job.workItemId,
        projectName: job.projectName,
        step: "workerError",
      }
    );
    throw error; // Re-throw so Azure Functions marks the message as failed (retry/poison queue)
  }
}

app.storageQueue("bug-fix-worker", {
  queueName: "bug-fix-jobs",
  connection: "AzureWebJobsStorage",
  handler,
});
