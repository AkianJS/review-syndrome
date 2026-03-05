import { WorkItemDetails, PullRequestParams, Repository, Config, ImageAttachment } from "./types.js";
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

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|bmp|webp|svg)$/i;

export function extractImagesFromHtml(html: string): ImageAttachment[] {
  if (!html) return [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const results: ImageAttachment[] = [];
  const seenUrls = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (seenUrls.has(url)) continue;

    // Derive filename from URL query param fileName= or last path segment
    let filename: string;
    try {
      const parsed = new URL(url);
      filename = parsed.searchParams.get("fileName") ?? parsed.pathname.split("/").pop() ?? "image";
    } catch {
      filename = url.split("/").pop()?.split("?")[0] ?? "image";
    }

    if (!IMAGE_EXTENSIONS.test(filename)) continue;

    seenUrls.add(url);
    results.push({ url, filename, source: "inline" });
  }

  return results;
}

export function extractAttachmentUrls(relations: Record<string, any>[] | undefined): ImageAttachment[] {
  if (!relations || !Array.isArray(relations)) return [];

  return relations
    .filter((rel) => rel.rel === "AttachedFile" && IMAGE_EXTENSIONS.test(rel.attributes?.name ?? ""))
    .map((rel) => ({
      url: rel.url as string,
      filename: (rel.attributes?.name ?? "attachment") as string,
      source: "attachment" as const,
    }));
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

  // Extract images from raw HTML BEFORE stripping HTML tags
  const inlineImages = [
    ...extractImagesFromHtml(fields["System.Description"] ?? ""),
    ...extractImagesFromHtml(fields["Microsoft.VSTS.TCM.ReproSteps"] ?? ""),
    ...extractImagesFromHtml(fields["Microsoft.VSTS.TCM.SystemInfo"] ?? ""),
  ];
  const attachmentImages = extractAttachmentUrls(wiData.relations);

  // Merge, deduplicate by URL, cap at 10
  const seenUrls = new Set<string>();
  const images: ImageAttachment[] = [];
  for (const img of [...inlineImages, ...attachmentImages]) {
    if (!seenUrls.has(img.url)) {
      seenUrls.add(img.url);
      images.push(img);
    }
    if (images.length >= 10) break;
  }

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
    images: images.length > 0 ? images : undefined,
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

export async function downloadWorkItemImages(
  images: ImageAttachment[],
  workDir: string,
  pat: string
): Promise<ImageAttachment[]> {
  if (!images || images.length === 0) return [];

  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const imagesDir = join(workDir, ".buginfo", "images");
  await mkdir(imagesDir, { recursive: true });

  const MAX_SIZE = 20 * 1024 * 1024; // 20MB
  const downloaded: ImageAttachment[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      const response = await fetch(img.url, {
        headers: { Authorization: buildAuthHeader(pat) },
      });

      if (!response.ok) {
        logger.warn(`Failed to download image ${img.filename}: HTTP ${response.status}`, { url: img.url });
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        logger.warn(`Skipping non-image content-type for ${img.filename}: ${contentType}`, { url: img.url });
        continue;
      }

      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > MAX_SIZE) {
        logger.warn(`Skipping oversized image ${img.filename}: ${contentLength} bytes`, { url: img.url });
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_SIZE) {
        logger.warn(`Skipping oversized image ${img.filename}: ${buffer.length} bytes (after download)`, { url: img.url });
        continue;
      }

      const localFilename = `${img.source}-${i}-${img.filename}`;
      const localPath = join(imagesDir, localFilename);
      await writeFile(localPath, buffer);

      downloaded.push({ ...img, localPath });
    } catch (error) {
      logger.warn(`Failed to download image ${img.filename}: ${error}`, { url: img.url });
    }
  }

  return downloaded;
}

export { stripHtml, buildAuthHeader, IMAGE_EXTENSIONS };
