import { app, InvocationContext } from "@azure/functions";
import { BugFixJob } from "../shared/types.js";
import { loadConfig } from "../shared/config.js";
import { processBugFixJob } from "../shared/pipeline.js";

async function handler(
  message: unknown,
  context: InvocationContext
): Promise<void> {
  const job = (typeof message === "string" ? JSON.parse(message) : message) as BugFixJob;

  context.log(`Processing bug fix job for work item #${job.workItemId} in project '${job.projectName}'`);

  try {
    const config = loadConfig();
    await processBugFixJob(job, config);
    context.log(`Successfully processed bug fix job for work item #${job.workItemId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    context.error(`Failed to process bug fix job for work item #${job.workItemId}: ${errorMessage}`);
    throw error; // Re-throw so Azure Functions marks the message as failed (retry/poison queue)
  }
}

app.storageQueue("bug-fix-worker", {
  queueName: "bug-fix-jobs",
  connection: "AzureWebJobsStorage",
  handler,
});
