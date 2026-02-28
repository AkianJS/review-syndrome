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
  let triggerType: "created" | "updated" | "manual";

  if (eventType === "workitem.created") {
    // Original flow: new bug created
    const workItemType = fields["System.WorkItemType"];
    if (workItemType !== "Bug") {
      logger.info(`Ignoring work item type: ${workItemType}`);
      return { status: 200, body: "Work item type not handled" };
    }
    triggerType = "created";
  } else if (eventType === "workitem.updated") {
    // Re-trigger: bug was updated with new info, or tag was added
    const workItemType =
      fields["System.WorkItemType"] ??
      resource.revision?.fields?.["System.WorkItemType"];
    if (workItemType !== "Bug") {
      logger.info(`Ignoring work item type: ${workItemType}`);
      return { status: 200, body: "Work item type not handled" };
    }

    // Check for manual trigger via tag
    const tags: string = fields["System.Tags"] ?? resource.revision?.fields?.["System.Tags"] ?? "";
    if (tags.split(";").map((t: string) => t.trim().toLowerCase()).includes("agent-fix")) {
      triggerType = "manual";
    } else {
      // Check if meaningful fields changed
      const meaningfulFields = [
        "System.Description",
        "Microsoft.VSTS.TCM.ReproSteps",
        "System.Tags",
      ];
      const hasRelevantChange = meaningfulFields.some(
        (f) => revisedFields[f] !== undefined
      );

      if (!hasRelevantChange) {
        logger.info("Work item updated but no relevant fields changed");
        return { status: 200, body: "No relevant fields changed" };
      }
      triggerType = "updated";
    }
  } else if (eventType === "workitem.commented") {
    // Manual trigger via comment: @agent fix this
    const commentText: string = resource.text ?? resource.comment?.text ?? "";
    if (!commentText.toLowerCase().includes("@agent fix this")) {
      logger.info("Comment does not contain @agent trigger");
      return { status: 200, body: "Comment trigger not matched" };
    }

    // For comment events, the work item info is nested differently
    const workItemType =
      fields["System.WorkItemType"] ??
      resource.revision?.fields?.["System.WorkItemType"] ?? "";
    if (workItemType !== "Bug") {
      logger.info(`Ignoring work item type: ${workItemType}`);
      return { status: 200, body: "Work item type not handled" };
    }
    triggerType = "manual";
  } else {
    logger.info(`Ignoring event type: ${eventType}`);
    return { status: 200, body: "Event type not handled" };
  }

  // Extract data
  const workItemId: number = resource.id ?? resource.workItemId;
  const projectName: string =
    fields["System.TeamProject"] ??
    resource.revision?.fields?.["System.TeamProject"] ?? "";

  if (!workItemId || !projectName) {
    return { status: 400, body: "Missing workItemId or projectName" };
  }

  // Idempotency check — for updates and manual triggers, reset the job first
  if (triggerType === "updated" || triggerType === "manual") {
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
