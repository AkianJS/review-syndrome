import { app, InvocationContext } from "@azure/functions";
import { PrRetryJob } from "../shared/types.js";
import { loadConfig } from "../shared/config.js";
import { getWorkItemDetails } from "../shared/azure-devops-client.js";
import { cloneRepo, hasChanges, pushBranch, cleanup } from "../shared/git-operations.js";
import { buildRetryPrompt } from "../shared/prompt-builder.js";
import { runAgent } from "../shared/agent-runner.js";
import { incrementRetryCount } from "../shared/job-tracker.js";
import { ensureTable } from "../shared/job-tracker.js";
import { createLogger } from "../shared/logger.js";
import { simpleGit } from "simple-git";

const logger = createLogger("PrRetry");

async function handler(
  message: unknown,
  context: InvocationContext
): Promise<void> {
  const job = (typeof message === "string" ? JSON.parse(message) : message) as PrRetryJob;

  logger.info("Processing PR retry job", {
    workItemId: job.workItemId,
    projectName: job.projectName,
    retryCount: job.retryCount,
    step: "dequeue",
  });

  let workDir: string | undefined;

  try {
    await ensureTable();
    const config = loadConfig(job.projectName);

    // Track retry count
    await incrementRetryCount(job.workItemId);

    // Fetch work item details for the prompt
    const workItem = await getWorkItemDetails(
      job.workItemId,
      job.projectName,
      config
    );

    // Clone and checkout the existing fix branch
    logger.info(`Cloning repo and checking out branch '${job.branchName}'`, {
      workItemId: job.workItemId,
      step: "clone",
    });

    const cloneResult = await cloneRepo(job.repoUrl, config.azureDevOpsPat);
    workDir = cloneResult.workDir;

    // Checkout the existing fix branch
    const git = simpleGit(workDir);
    await git.checkout(job.branchName);

    // Build retry prompt with CI failure context
    const prompt = buildRetryPrompt(workItem, job.ciFailureLog);

    // Run agent
    logger.info("Running agent for PR retry", {
      workItemId: job.workItemId,
      retryCount: job.retryCount,
      step: "runAgent",
    });

    const agentResult = await runAgent(prompt, workDir, config);

    if (!agentResult.success) {
      logger.warn("Agent could not fix CI failure", {
        workItemId: job.workItemId,
        retryCount: job.retryCount,
        step: "agentFailed",
      });
      return;
    }

    // Check if agent made any changes
    const changed = await hasChanges(workDir);
    if (!changed) {
      logger.info("Agent made no changes during retry", {
        workItemId: job.workItemId,
        retryCount: job.retryCount,
        step: "noChanges",
      });
      return;
    }

    // Commit and push to the same branch
    await git.add("-A");
    await git.commit(`fix: address CI failure (retry #${job.retryCount}) (WI #${job.workItemId})`);
    await pushBranch(workDir, job.branchName);

    logger.info("PR retry fix pushed successfully", {
      workItemId: job.workItemId,
      retryCount: job.retryCount,
      step: "pushed",
      costUsd: agentResult.costUsd,
    });
    logger.trackEvent("pr_retry_completed", {
      workItemId: job.workItemId,
      retryCount: job.retryCount,
      costUsd: agentResult.costUsd,
    });
  } catch (error) {
    logger.error(
      `Failed to process PR retry for WI #${job.workItemId}`,
      error instanceof Error ? error : undefined,
      {
        workItemId: job.workItemId,
        retryCount: job.retryCount,
        step: "retryError",
      }
    );
    throw error;
  } finally {
    if (workDir) {
      await cleanup(workDir);
    }
  }
}

app.storageQueue("pr-retry-worker", {
  queueName: "pr-retry-jobs",
  connection: "AzureWebJobsStorage",
  handler,
});
