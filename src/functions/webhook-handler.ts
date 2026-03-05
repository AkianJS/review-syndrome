import { app, HttpRequest, HttpResponseInit, InvocationContext, output } from "@azure/functions";
import { BugFixJob } from "../shared/types.js";
import { isJobProcessed, resetJob } from "../shared/job-tracker.js";
import { createLogger } from "../shared/logger.js";

const logger = createLogger("Webhook");

const queueOutput = output.storageQueue({
  queueName: "bug-fix-jobs",
  connection: "AzureWebJobsStorage",
});

async function handler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  logger.info("Webhook received from Azure DevOps");

  let body: Record<string, any>;
  try {
    body = (await request.json()) as Record<string, any>;
  } catch {
    return { status: 400, body: "Invalid JSON body" };
  }

  const eventType = body.eventType;
  const resource = body.resource ?? {};
  const fields = resource.fields ?? {};
  const revisedFields = resource.revisedFields ?? {};

  // Determine trigger type and validate
  let triggerType: "created" | "updated";

  if (eventType === "workitem.created") {
    // New work item created — only process if it has the ai-fix tag
    const tags = fields["System.Tags"] ?? "";
    if (!parseTags(tags).includes("ai-fix")) {
      logger.info("Work item created without ai-fix tag, ignoring");
      return { status: 200, body: "Tag ai-fix not present" };
    }
    triggerType = "created";
  } else if (eventType === "workitem.updated") {
    // Updated work item — process if it has the ai-fix tag
    // For updated events, resource.fields contains {oldValue, newValue} deltas,
    // while resource.revision.fields contains the full current field values
    const rawFieldTags = fields["System.Tags"];
    const tags = resource.revision?.fields?.["System.Tags"]
      ?? (rawFieldTags && typeof rawFieldTags === "object" ? rawFieldTags.newValue : rawFieldTags)
      ?? "";
    if (!parseTags(tags).includes("ai-fix")) {
      logger.info("Work item updated without ai-fix tag, ignoring");
      return { status: 200, body: "Tag ai-fix not present" };
    }

    // Check if meaningful fields changed (or tag was just added)
    // Also check resource.fields which contains the delta for updated events
    const meaningfulFields = [
      "System.Description",
      "Microsoft.VSTS.TCM.ReproSteps",
      "System.Tags",
    ];
    const hasRelevantChange = meaningfulFields.some(
      (f) => revisedFields[f] !== undefined || fields[f] !== undefined
    );

    if (!hasRelevantChange) {
      logger.info("Work item updated but no relevant fields changed");
      return { status: 200, body: "No relevant fields changed" };
    }
    triggerType = "updated";
  } else if (eventType === "workitem.commented") {
    // Alternative trigger via comment: @agent fix this (any work item type)
    const commentText: string = resource.text ?? resource.comment?.text ?? "";
    if (!commentText.toLowerCase().includes("@agent fix this")) {
      logger.info("Comment does not contain @agent trigger");
      return { status: 200, body: "Comment trigger not matched" };
    }
    triggerType = "updated";
  } else {
    logger.info(`Ignoring event type: ${eventType}`);
    return { status: 200, body: "Event type not handled" };
  }

  // Extract data
  // For workitem.updated, resource.id is the revision number, not the work item ID
  const workItemId: number = resource.workItemId ?? resource.revision?.id ?? resource.id;
  const projectName: string =
    fields["System.TeamProject"] ??
    resource.revision?.fields?.["System.TeamProject"] ?? "";

  if (!workItemId || !projectName) {
    return { status: 400, body: "Missing workItemId or projectName" };
  }

  // Idempotency check — for updates, reset the job first so it can be re-processed
  if (triggerType === "updated") {
    try {
      await resetJob(workItemId);
      logger.info(`Reset job for re-trigger`, { workItemId, triggerType });
    } catch {
      logger.warn("Could not reset job for re-trigger", { workItemId });
    }
  } else {
    try {
      const alreadyProcessed = await isJobProcessed(workItemId);
      if (alreadyProcessed) {
        logger.info(`Work item #${workItemId} already processed, skipping`, { workItemId });
        return {
          status: 200,
          body: JSON.stringify({ message: "Already processed", workItemId }),
        };
      }
    } catch {
      logger.warn("Could not check idempotency, proceeding with enqueue", { workItemId });
    }
  }

  // Derive organization URL from resource URL or use env var
  const organizationUrl =
    process.env["AZURE_DEVOPS_ORG_URL"] ??
    extractOrgUrl(resource.url ?? "");

  const job: BugFixJob = {
    workItemId,
    projectName,
    organizationUrl,
    timestamp: new Date().toISOString(),
    triggerType,
  };

  // Enqueue the job
  context.extraOutputs.set(queueOutput, job);

  logger.info(`Enqueued bug fix job for work item #${workItemId}`, { workItemId, projectName, triggerType });
  logger.trackEvent("bug_received", { workItemId, projectName, triggerType });

  return {
    status: 200,
    body: JSON.stringify({ message: "Bug fix job enqueued", workItemId, triggerType }),
  };
}

function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.map((t: string) => String(t).trim().toLowerCase());
  }
  if (typeof tags === "string") {
    return tags.split(";").map((t) => t.trim().toLowerCase());
  }
  return [];
}

function extractOrgUrl(resourceUrl: string): string {
  // resourceUrl looks like: https://dev.azure.com/{org}/{project}/_apis/...
  try {
    const url = new URL(resourceUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 1) {
      return `${url.origin}/${parts[0]}`;
    }
  } catch {
    // Fall through
  }
  return "";
}

app.http("webhook-handler", {
  methods: ["POST"],
  authLevel: "anonymous",
  extraOutputs: [queueOutput],
  handler,
});

export { handler, extractOrgUrl };
