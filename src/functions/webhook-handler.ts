import { app, HttpRequest, HttpResponseInit, InvocationContext, output } from "@azure/functions";
import { BugFixJob } from "../shared/types.js";

const queueOutput = output.storageQueue({
  queueName: "bug-fix-jobs",
  connection: "AzureWebJobsStorage",
});

async function handler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log("Webhook received from Azure DevOps");

  let body: Record<string, any>;
  try {
    body = (await request.json()) as Record<string, any>;
  } catch {
    return { status: 400, body: "Invalid JSON body" };
  }

  // Validate event type
  const eventType = body.eventType;
  if (eventType !== "workitem.created") {
    context.log(`Ignoring event type: ${eventType}`);
    return { status: 200, body: "Event type not handled" };
  }

  // Validate work item type is Bug
  const resource = body.resource ?? {};
  const fields = resource.fields ?? {};
  const workItemType = fields["System.WorkItemType"];
  if (workItemType !== "Bug") {
    context.log(`Ignoring work item type: ${workItemType}`);
    return { status: 200, body: "Work item type not handled" };
  }

  // Extract data
  const workItemId: number = resource.id;
  const projectName: string = fields["System.TeamProject"];

  if (!workItemId || !projectName) {
    return { status: 400, body: "Missing workItemId or projectName" };
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
  };

  // Enqueue the job
  context.extraOutputs.set(queueOutput, job);
  context.log(`Enqueued bug fix job for work item #${workItemId}`);

  return {
    status: 200,
    body: JSON.stringify({ message: "Bug fix job enqueued", workItemId }),
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
