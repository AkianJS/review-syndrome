import { WorkItemDetails, PullRequestParams, Repository, Config } from "./types.js";
import { withRetry, isRetryableHttpError } from "./retry.js";
import { createLogger } from "./logger.js";

const logger = createLogger("AzureDevOps");

function buildAuthHeader(pat: string): string {
  const encoded = Buffer.from(`:${pat}`).toString("base64");
  return `Basic ${encoded}`;
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function adoFetch(url: string, pat: string, options: RequestInit = {}): Promise<Response> {
  return withRetry(
    async () => {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: buildAuthHeader(pat),
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Azure DevOps API error ${response.status}: ${body}`);
      }
      return response;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1000,
      retryOn: isRetryableHttpError,
    }
  );
}

export async function getWorkItemDetails(
  workItemId: number,
  projectName: string,
  config: Config
): Promise<WorkItemDetails> {
  const baseUrl = config.azureDevOpsOrgUrl;
  logger.info(`Fetching work item #${workItemId}`, { workItemId, projectName, step: "getWorkItem" });

  // Fetch work item with all fields
  const wiUrl = `${baseUrl}/${projectName}/_apis/wit/workitems/${workItemId}?$expand=All&api-version=7.1`;
  const wiResponse = await adoFetch(wiUrl, config.azureDevOpsPat);
  const wiData = await wiResponse.json() as Record<string, any>;

  // Fetch comments
  const commentsUrl = `${baseUrl}/${projectName}/_apis/wit/workItems/${workItemId}/comments?api-version=7.1-preview.4`;
  let comments: string[] = [];
  try {
    const commentsResponse = await adoFetch(commentsUrl, config.azureDevOpsPat);
    const commentsData = await commentsResponse.json() as Record<string, any>;
    comments = (commentsData.comments ?? []).map(
      (c: Record<string, any>) => stripHtml(c.text ?? "")
    );
  } catch {
    logger.warn(`Could not fetch comments for work item #${workItemId}`, { workItemId });
  }

  const fields = wiData.fields ?? {};

  return {
    id: wiData.id,
    title: fields["System.Title"] ?? "",
    description: stripHtml(fields["System.Description"] ?? ""),
    reproSteps: stripHtml(fields["Microsoft.VSTS.TCM.ReproSteps"] ?? ""),
    severity: fields["Microsoft.VSTS.Common.Severity"] ?? "Unknown",
    priority: String(fields["Microsoft.VSTS.Common.Priority"] ?? "Unknown"),
    systemInfo: stripHtml(fields["Microsoft.VSTS.TCM.SystemInfo"] ?? ""),
    comments,
    projectName,
    organizationUrl: baseUrl,
    areaPath: fields["System.AreaPath"] ?? undefined,
  };
}

export async function getRepositories(
  projectName: string,
  config: Config
): Promise<Repository[]> {
  logger.info(`Listing repositories for project '${projectName}'`, { projectName, step: "getRepos" });
  const url = `${config.azureDevOpsOrgUrl}/${projectName}/_apis/git/repositories?api-version=7.1`;
  const response = await adoFetch(url, config.azureDevOpsPat);
  const data = await response.json() as Record<string, any>;

  return (data.value ?? []).map((repo: Record<string, any>) => ({
    id: repo.id,
    name: repo.name,
    remoteUrl: repo.remoteUrl,
    defaultBranch: (repo.defaultBranch ?? "refs/heads/main").replace("refs/heads/", ""),
  }));
}

export async function createPullRequest(
  projectName: string,
  repoId: string,
  params: PullRequestParams,
  config: Config
): Promise<Record<string, any>> {
  logger.info(`Creating PR for work item #${params.workItemId}`, {
    workItemId: params.workItemId,
    projectName,
    step: "createPR",
  });

  const url = `${config.azureDevOpsOrgUrl}/${projectName}/_apis/git/repositories/${repoId}/pullrequests?api-version=7.1`;
  const body = {
    sourceRefName: params.sourceRefName,
    targetRefName: params.targetRefName,
    title: params.title,
    description: params.description,
    workItemRefs: [{ id: String(params.workItemId) }],
  };

  const response = await adoFetch(url, config.azureDevOpsPat, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return await response.json() as Record<string, any>;
}

export async function addWorkItemComment(
  workItemId: number,
  projectName: string,
  comment: string,
  config: Config
): Promise<void> {
  logger.info(`Adding comment to work item #${workItemId}`, { workItemId, projectName, step: "addComment" });

  const url = `${config.azureDevOpsOrgUrl}/${projectName}/_apis/wit/workItems/${workItemId}/comments?api-version=7.1-preview.4`;
  await adoFetch(url, config.azureDevOpsPat, {
    method: "POST",
    body: JSON.stringify({ text: comment }),
  });
}

export async function getBuildLog(
  projectName: string,
  buildId: number,
  config: Config
): Promise<string> {
  logger.info(`Fetching build log for build #${buildId}`, { projectName, buildId, step: "getBuildLog" });

  const timelineUrl = `${config.azureDevOpsOrgUrl}/${projectName}/_apis/build/builds/${buildId}/timeline?api-version=7.1`;
  const response = await adoFetch(timelineUrl, config.azureDevOpsPat);
  const data = await response.json() as Record<string, any>;

  // Extract error messages from failed records
  const failedRecords = (data.records ?? []).filter(
    (r: Record<string, any>) => r.result === "failed" || r.result === "partiallySucceeded"
  );

  const errors = failedRecords.map(
    (r: Record<string, any>) => `[${r.name}] ${r.issues?.map((i: Record<string, any>) => i.message).join("; ") ?? "Failed"}`
  );

  return errors.join("\n") || "Build failed (no detailed error messages available)";
}

export { stripHtml, buildAuthHeader };
