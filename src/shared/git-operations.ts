import { simpleGit, SimpleGit } from "simple-git";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { withRetry, isRetryableGitError } from "./retry.js";
import { createLogger } from "./logger.js";

const logger = createLogger("Git");

export function sanitizeBranchName(workItemId: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return `bugfix/wi-${workItemId}-${slug}`;
}

export async function cloneRepo(
  cloneUrl: string,
  pat: string
): Promise<{ workDir: string; git: SimpleGit }> {
  const workDir = await mkdtemp(join(tmpdir(), "review-syndrome-"));
  logger.info(`Cloning repo to ${workDir}`, { step: "clone" });

  // Inject PAT into the clone URL for authentication
  const authedUrl = cloneUrl.replace("https://", `https://${pat}@`);

  await withRetry(
    async () => {
      const git = simpleGit();
      await git.clone(authedUrl, workDir);
    },
    {
      maxAttempts: 3,
      baseDelayMs: 2000,
      retryOn: isRetryableGitError,
    }
  );

  return { workDir, git: simpleGit(workDir) };
}

export async function createBranchAndCommit(
  workDir: string,
  branchName: string,
  commitMessage: string
): Promise<void> {
  logger.info(`Creating branch '${branchName}'`, { step: "branch" });
  const git = simpleGit(workDir);
  await git.checkoutLocalBranch(branchName);
  await git.add("-A");
  await git.commit(commitMessage);
}

export async function pushBranch(
  workDir: string,
  branchName: string
): Promise<void> {
  logger.info(`Pushing branch '${branchName}'`, { step: "push" });

  await withRetry(
    async () => {
      const git = simpleGit(workDir);
      await git.push("origin", branchName);
    },
    {
      maxAttempts: 3,
      baseDelayMs: 2000,
      retryOn: isRetryableGitError,
    }
  );
}

export async function hasChanges(workDir: string): Promise<boolean> {
  const git = simpleGit(workDir);
  const status = await git.status();
  return !status.isClean();
}

export async function getChangeSummary(workDir: string): Promise<string> {
  const git = simpleGit(workDir);
  const diff = await git.diff(["--stat"]);
  return diff || "No changes detected.";
}

export async function cleanup(workDir: string): Promise<void> {
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}
