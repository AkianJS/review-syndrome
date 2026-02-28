import { BugFixJob, Config, Repository } from "./types.js";
import { getWorkItemDetails, getRepositories, createPullRequest, addWorkItemComment } from "./azure-devops-client.js";
import {
  cloneRepo,
  sanitizeBranchName,
  hasChanges,
  getChangeSummary,
  createBranchAndCommit,
  pushBranch,
  cleanup,
} from "./git-operations.js";
import { buildAgentPrompt } from "./prompt-builder.js";
import { runAgent } from "./agent-runner.js";
import { markJobStarted, markJobCompleted } from "./job-tracker.js";
import { createLogger } from "./logger.js";

const logger = createLogger("Pipeline");

export async function processBugFixJob(
  job: BugFixJob,
  config: Config
): Promise<void> {
  const startTime = Date.now();
  let workDir: string | undefined;
  const props = { workItemId: job.workItemId, projectName: job.projectName };

  try {
    // 0. Idempotency check
    const claimed = await markJobStarted(job.workItemId);
    if (!claimed) {
      logger.info("Job already processed or in-progress, skipping", { ...props, step: "idempotency" });
      return;
    }

    logger.trackEvent("bug_processing_started", props);

    // 1. Fetch full work item details
    logger.info("Fetching work item details", { ...props, step: "fetchWorkItem" });
    const workItem = await getWorkItemDetails(
      job.workItemId,
      job.projectName,
      config
    );

    // 2. Determine repository
    logger.info("Looking up repositories", { ...props, step: "getRepos" });
    const repos = await getRepositories(job.projectName, config);
    if (repos.length === 0) {
      throw new Error(`No repositories found in project '${job.projectName}'`);
    }
    const repo = selectRepository(repos, workItem.areaPath, config);

    // 3. Clone repo to temp dir
    logger.info(`Cloning repository '${repo.name}'`, { ...props, step: "clone" });
    const cloneResult = await cloneRepo(repo.remoteUrl, config.azureDevOpsPat);
    workDir = cloneResult.workDir;

    // 4. Build prompt
    const prompt = buildAgentPrompt(workItem);

    // 5. Run Claude agent
    logger.info("Running Claude agent", { ...props, step: "runAgent", model: config.agentModel });
    let agentResult = await runAgent(prompt, workDir, config);

    // 5a. Tiered model fallback: if Sonnet fails, retry with Opus
    if (!agentResult.success && !config.agentModel.includes("opus")) {
      logger.info("Escalating to Opus model", { ...props, step: "modelEscalation" });
      logger.trackEvent("model_escalated", { ...props, fromModel: config.agentModel, toModel: "claude-opus-4-6" });

      const firstRunCost = agentResult.costUsd;
      const opusConfig = { ...config, agentModel: "claude-opus-4-6" };
      agentResult = await runAgent(prompt, workDir, opusConfig);
      agentResult.costUsd += firstRunCost;
      agentResult.escalated = true;
    }

    if (!agentResult.success) {
      logger.warn("Agent could not fix bug", { ...props, step: "agentFailed", analysis: agentResult.analysis, escalated: agentResult.escalated });
      logger.trackEvent("bug_processing_completed", { ...props, outcome: "agent_failed", escalated: agentResult.escalated });
      await markJobCompleted(job.workItemId, "failure");

      // Comment on work item
      await safeAddComment(
        job.workItemId,
        job.projectName,
        `**ReviewSyndrome Agent** analyzed this work item but could not create an automated fix.\n\n**Reason:** ${truncate(agentResult.analysis, 500)}`,
        config
      );
      return;
    }

    // 6. Check if agent made changes
    const changed = await hasChanges(workDir);
    if (!changed) {
      logger.info("Agent made no file changes", { ...props, step: "noChanges" });
      logger.trackEvent("agent_no_changes", props);
      await markJobCompleted(job.workItemId, "no-changes");

      await safeAddComment(
        job.workItemId,
        job.projectName,
        `**ReviewSyndrome Agent** analyzed this work item but determined no code changes were necessary.\n\n**Analysis:** ${truncate(agentResult.analysis, 500)}`,
        config
      );
      return;
    }

    // 7. Create branch, commit, push
    const branchName = sanitizeBranchName(job.workItemId, workItem.title);
    const commitMessage = `fix: ${workItem.title} (WI #${job.workItemId})`;
    logger.info(`Creating branch '${branchName}' and pushing`, { ...props, step: "pushBranch" });
    await createBranchAndCommit(workDir, branchName, commitMessage);
    await pushBranch(workDir, branchName);

    // 8. Create PR
    const changeSummary = await getChangeSummary(workDir);
    const targetBranch = config.targetBranch;
    const prDescription = buildPrDescription(workItem, agentResult, changeSummary);

    logger.info("Creating pull request", { ...props, step: "createPR" });
    const pr = await createPullRequest(
      job.projectName,
      repo.id,
      {
        sourceRefName: `refs/heads/${branchName}`,
        targetRefName: `refs/heads/${targetBranch}`,
        title: `Fix: ${workItem.title} (WI #${job.workItemId})`,
        description: prDescription,
        workItemId: job.workItemId,
      },
      config
    );

    const prId = pr.pullRequestId as number;
    const durationMs = Date.now() - startTime;

    logger.info(`PR created successfully`, { ...props, step: "prCreated", prId, durationMs });
    logger.trackEvent("pr_created", { ...props, prId, costUsd: agentResult.costUsd });
    logger.trackMetric("processing_duration_ms", durationMs, props);

    await markJobCompleted(job.workItemId, "success", prId);

    // Comment on work item
    await safeAddComment(
      job.workItemId,
      job.projectName,
      `**ReviewSyndrome Agent** created PR #${prId} for this work item.\n\n**Cost:** ~$${agentResult.costUsd.toFixed(2)} | **Duration:** ${Math.round(durationMs / 1000)}s`,
      config
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(
      `Failed to process bug #${job.workItemId}`,
      error instanceof Error ? error : undefined,
      { ...props, step: "pipelineError", durationMs }
    );
    logger.trackEvent("bug_processing_failed", { ...props, error: String(error) });

    try {
      await markJobCompleted(job.workItemId, "failure");
    } catch {
      // Best-effort status update
    }

    throw error;
  } finally {
    // 9. Cleanup
    if (workDir) {
      await cleanup(workDir);
    }
  }
}

async function safeAddComment(
  workItemId: number,
  projectName: string,
  comment: string,
  config: Config
): Promise<void> {
  try {
    await addWorkItemComment(workItemId, projectName, comment, config);
  } catch (err) {
    logger.warn(`Failed to add comment to work item #${workItemId}`, { workItemId });
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function selectRepository(
  repos: Repository[],
  areaPath: string | undefined,
  config: Config
): Repository {
  if (areaPath && config.repoMapping) {
    // Check for exact match first, then prefix match
    const mappedRepoName =
      config.repoMapping[areaPath] ??
      Object.entries(config.repoMapping).find(([path]) => areaPath.startsWith(path))?.[1];

    if (mappedRepoName) {
      const matched = repos.find((r) => r.name === mappedRepoName);
      if (matched) {
        logger.info(`Selected repo '${matched.name}' via area path mapping`, { areaPath, repoName: matched.name });
        return matched;
      }
    }
  }
  return repos[0];
}

function buildPrDescription(
  workItem: { id: number; title: string; severity: string; priority: string },
  agentResult: { analysis: string; costUsd: number; durationMs: number },
  changeSummary: string
): string {
  return `## Automated Fix by ReviewSyndrome Agent

**Bug**: #${workItem.id} — ${workItem.title}
**Severity**: ${workItem.severity} | **Priority**: ${workItem.priority}

### Root Cause Analysis
${agentResult.analysis}

### Changes Made
\`\`\`
${changeSummary}
\`\`\`

---

> This PR was automatically generated by **ReviewSyndrome Agent** using Claude Sonnet.
> Please review carefully before merging.
> AI-generated cost: ~$${agentResult.costUsd.toFixed(2)} | Duration: ${Math.round(agentResult.durationMs / 1000)}s`;
}
