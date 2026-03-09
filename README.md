# ReviewSyndrome Agent

Autonomous AI agent that fixes issues from Azure DevOps work items and creates Pull Requests using Claude.

When any work item (Bug, Issue, Task, etc.) with the `ai-fix` tag is created or updated in Azure DevOps, ReviewSyndrome automatically:
1. Receives the webhook notification
2. Clones the relevant repository
3. Runs Claude AI to analyze and fix the issue
4. Creates a Pull Request with the fix

The PR serves as the human review gate. Developers review and merge as they would any other PR.

---

## Prerequisites

- **Node.js 20+** — [Download](https://nodejs.org/)
- **Azure Functions Core Tools v4** — [Install guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local)
- **Azure CLI** — [Install guide](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) (for deployment only)
- **Git** — installed and available in PATH
- **Azurite** (optional) — local Azure Storage emulator for development. Install with `npm install -g azurite`
- **An Anthropic API key** — [Get one here](https://console.anthropic.com/)
- **An Azure DevOps organization** with at least one project containing a Git repository

---

## Quick Start (Local Development)

### 1. Clone and install

```bash
git clone https://github.com/AkianJS/review-syndrome.git
cd review-syndrome
npm install
```

### 2. Configure local settings

Create `local.settings.json` in the project root. This is the only configuration file needed — Azure Functions Core Tools reads it automatically. No environment variables required.

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/yourorg",
    "AZURE_DEVOPS_PAT": "your-personal-access-token",
    "ANTHROPIC_API_KEY": "sk-ant-your-api-key",
    "TARGET_BRANCH": "main",
    "MAX_BUDGET_PER_BUG": "2.00",
    "MAX_AGENT_TURNS": "50",
    "AGENT_MODEL": "claude-sonnet-4-6",
    "WEBHOOK_API_KEY": "",
    "DASHBOARD_API_KEY": "",
    "APPLICATIONINSIGHTS_CONNECTION_STRING": ""
  }
}
```

#### Azure DevOps PAT permissions

Create a Personal Access Token at `https://dev.azure.com/{yourorg}/_usersSettings/tokens` with these scopes:

| Scope | Permission | Why |
|-------|-----------|-----|
| **Work Items** | Read & Write | Fetch work item details, post comments |
| **Code** | Read & Write | Clone repos, create branches, push code |
| **Pull Request Threads** | Read & Write | Create PRs |

### 3. Start the local storage emulator

In a separate terminal:

```bash
azurite --silent --location ./azurite-data --debug ./azurite-debug.log
```

Or if you have Docker:

```bash
docker run -p 10000:10000 -p 10001:10001 -p 10002:10002 mcr.microsoft.com/azure-storage/azurite
```

### 4. Build and start

```bash
npm run build
func start
```

The Functions host starts with these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/webhook-handler` | POST | Receives Azure DevOps webhooks |
| `/api/pr-status-handler` | POST | Receives build completion webhooks |
| `/api/health-check` | GET | System health check |
| `/api/dashboard` | GET | Job metrics and recent activity |

### 5. Test it manually

You can simulate a webhook by sending a POST request:

```bash
curl -X POST http://localhost:7071/api/webhook-handler \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "workitem.created",
    "resource": {
      "id": 123,
      "url": "https://dev.azure.com/yourorg/YourProject/_apis/wit/workitems/123",
      "fields": {
        "System.WorkItemType": "Issue",
        "System.TeamProject": "YourProject",
        "System.Title": "Null reference in login handler",
        "System.Tags": "ai-fix"
      }
    }
  }'
```

Check health:

```bash
curl http://localhost:7071/api/health-check
```

View dashboard:

```bash
curl http://localhost:7071/api/dashboard
```

### 6. Run tests

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

---

## Setting Up Azure DevOps Webhooks

### Securing Webhooks with API Keys

All HTTP endpoints support optional API key authentication. Set `WEBHOOK_API_KEY` (for webhook endpoints) and/or `DASHBOARD_API_KEY` (for dashboard/health-check) in your app settings. When set, requests must include the key via one of:

- **Header**: `X-Api-Key: <your-key>`
- **Bearer token**: `Authorization: Bearer <your-key>`

If the env var is not set, authentication is skipped (backwards-compatible).

**Azure DevOps service hooks** support custom HTTP headers natively. When creating a webhook subscription, add `X-Api-Key: <your-key>` in the **HTTP headers** field.

### Webhook for Work Item Creation (required)

1. Go to your Azure DevOps project
2. Navigate to **Project Settings** > **Service Hooks**
3. Click **+** to create a new subscription
4. Select **Web Hooks** as the service
5. Configure the trigger:
   - **Event**: `Work item created`
   - **Filters**: none required (the handler checks for the `ai-fix` tag)
6. Configure the action:
   - **URL**: `https://<your-function-app>.azurewebsites.net/api/webhook-handler`
   - **HTTP headers**: (none required)
7. Click **Test** to verify, then **Finish**

### Webhook for Work Item Updates (recommended)

Create another service hook:

- **Event**: `Work item updated`
- **Filters**: none required
- **URL**: same webhook URL

This enables processing when the `ai-fix` tag is added to an existing work item, or when the description/repro steps are updated on a tagged item.

### Webhook for CI Auto-Retry (optional)

Create another service hook:

- **Event**: `Build completed`
- **URL**: `https://<your-function-app>.azurewebsites.net/api/pr-status-handler`

When a CI build fails on a `bugfix/wi-*` branch, the agent automatically retries the fix (up to 2 times).

---

## Trigger Methods

ReviewSyndrome is triggered by the `ai-fix` tag. Any work item type (Bug, Issue, Task, etc.) is supported.

| Method | How | Event Type |
|--------|-----|------------|
| **Create with tag** | Create any work item with the `ai-fix` tag | `workitem.created` |
| **Add tag later** | Add the `ai-fix` tag to an existing work item | `workitem.updated` |
| **Re-trigger** | Edit the description or repro steps on a tagged item | `workitem.updated` |
| **Comment trigger** | Comment `@agent fix this` on any work item | `workitem.commented` |

---

## Project Configuration

### Per-project overrides

Edit `config/config.json` to customize behavior per project:

```json
{
  "projects": {
    "MyProject": {
      "defaultBranch": "develop",
      "agentModel": "claude-sonnet-4-6",
      "maxBudget": 3.0,
      "maxTurns": 75,
      "enabled": true,
      "repoMapping": {
        "MyProject\\Backend": "backend-api",
        "MyProject\\Frontend": "web-app"
      }
    },
    "AnotherProject": {
      "enabled": false
    }
  },
  "globalDefaults": {
    "defaultBranch": "main",
    "agentModel": "claude-sonnet-4-6",
    "maxBudget": 2.0,
    "maxTurns": 50,
    "enabled": true
  }
}
```

### Multi-repo support

If your project has multiple repositories, use `repoMapping` to map Azure DevOps area paths to repository names. The agent uses the bug's area path to select the correct repo. If no mapping matches, it falls back to the first repository in the project.

### Tiered model strategy

By default, the agent uses Claude Sonnet. If Sonnet fails to fix the issue, it automatically retries with Claude Opus (more capable but more expensive). To use Opus from the start for a specific project, set `"agentModel": "claude-opus-4-6"` in the project config.

---

## Configuration Reference

All settings go in `local.settings.json` (local dev) or **Application Settings** (deployed Azure Function). No standalone environment variables needed.

| Setting | Required | Default | Description |
|---------|----------|---------|-------------|
| `AZURE_DEVOPS_ORG_URL` | Yes | — | `https://dev.azure.com/yourorg` |
| `AZURE_DEVOPS_PAT` | Yes | — | Personal Access Token |
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `AzureWebJobsStorage` | Yes | — | Azure Storage connection string (or `UseDevelopmentStorage=true`) |
| `TARGET_BRANCH` | No | `main` | Default PR target branch |
| `MAX_BUDGET_PER_BUG` | No | `2.00` | Max Claude API cost per work item (USD) |
| `MAX_AGENT_TURNS` | No | `50` | Max agent reasoning turns |
| `AGENT_MODEL` | No | `claude-sonnet-4-6` | Default Claude model |
| `WEBHOOK_API_KEY` | No | — | Shared secret for webhook endpoints (auth disabled if not set) |
| `DASHBOARD_API_KEY` | No | — | Shared secret for dashboard/health-check endpoints (auth disabled if not set) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | — | Enable Application Insights telemetry |

---

## Deploy to Azure

### Option 1: Azure CLI + Bicep (recommended)

1. **Login to Azure**:

```bash
az login
az account set --subscription "<your-subscription-id>"
```

2. **Create a resource group**:

```bash
az group create --name rg-reviewsyndrome --location eastus2
```

3. **Edit parameters**:

Open `infra/parameters.json` and fill in your values:

```json
{
  "parameters": {
    "baseName": { "value": "reviewsyndrome" },
    "azureDevOpsOrgUrl": { "value": "https://dev.azure.com/yourorg" },
    "azureDevOpsPat": { "value": "your-pat-here" },
    "anthropicApiKey": { "value": "sk-ant-your-key-here" }
  }
}
```

4. **Deploy the infrastructure**:

```bash
az deployment group create \
  --resource-group rg-reviewsyndrome \
  --template-file infra/main.bicep \
  --parameters infra/parameters.json
```

This creates:
- Azure Function App (Consumption Plan, Node.js 20, Linux)
- Azure Storage Account (queues + tables)
- Azure Key Vault (stores PAT and API key)
- Application Insights + Log Analytics

5. **Deploy the function code**:

```bash
npm run build
func azure functionapp publish <your-function-app-name>
```

The function app name is in the deployment output. You can also find it with:

```bash
az deployment group show \
  --resource-group rg-reviewsyndrome \
  --name main \
  --query properties.outputs.functionAppUrl.value
```

6. **Configure the webhooks** in Azure DevOps (see [Setting Up Azure DevOps Webhooks](#setting-up-azure-devops-webhooks) above), using the deployed URL from the output.

### Option 2: VS Code

1. Install the [Azure Functions extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurefunctions)
2. Open the project in VS Code
3. Use the Azure Functions extension to deploy directly from the editor

---

## Architecture

```
Azure DevOps                    Azure Functions
  (ai-fix tag) ──webhook──> [webhook-handler] ──queue──> [bug-fix-worker]
                                                              │
  (Build Failed) ──webhook──> [pr-status-handler] ──queue──> [pr-retry-worker]
                                                              │
                                                              ▼
                                                        Clone repo
                                                        Run Claude Agent
                                                        Create branch + PR
                                                              │
                                                              ▼
                                                        Azure DevOps
                                                        (Pull Request)
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| Webhook Handler | `src/functions/webhook-handler.ts` | Receives ADO webhooks, validates, enqueues jobs |
| Bug Fix Worker | `src/functions/bug-fix-worker.ts` | Dequeues jobs, runs the fix pipeline |
| PR Status Handler | `src/functions/pr-status-handler.ts` | Receives build webhooks, enqueues retry jobs |
| PR Retry Worker | `src/functions/pr-retry-worker.ts` | Re-runs agent on failed CI branches |
| Health Check | `src/functions/health-check.ts` | GET endpoint for monitoring |
| Dashboard | `src/functions/dashboard.ts` | GET endpoint for job metrics |
| Pipeline | `src/shared/pipeline.ts` | Orchestrates the full fix flow |
| Agent Runner | `src/shared/agent-runner.ts` | Wraps Claude Agent SDK |
| ADO Client | `src/shared/azure-devops-client.ts` | Azure DevOps REST API wrapper |
| Git Operations | `src/shared/git-operations.ts` | Clone, branch, commit, push |
| Prompt Builder | `src/shared/prompt-builder.ts` | Constructs agent prompts |
| Job Tracker | `src/shared/job-tracker.ts` | Idempotency via Table Storage |
| Logger | `src/shared/logger.ts` | Structured logging + App Insights |
| Retry | `src/shared/retry.ts` | Exponential backoff with jitter |
| Config | `src/shared/config.ts` | Environment + per-project config |

---

## How It Works

1. A work item with the `ai-fix` tag is created or updated in Azure DevOps
2. The service hook sends a webhook to the Function App
3. `webhook-handler` checks for the `ai-fix` tag and enqueues a job message
4. `bug-fix-worker` picks up the message from the queue
5. The pipeline:
   - Fetches full work item details from Azure DevOps API
   - Selects the correct repository (using area path mapping if configured)
   - Clones the repository
   - Builds a structured prompt with the work item details
   - Runs the Claude Agent SDK with restricted tool access
   - If the agent fails with Sonnet, retries with Opus
   - If the agent makes code changes, creates a branch, commits, and pushes
   - Creates a Pull Request linked to the work item
   - Posts a comment on the work item with the PR link
6. If CI fails on the PR, `pr-status-handler` catches the build webhook and enqueues a retry (up to 2 retries)

---

## Cost Estimates

### Azure Infrastructure (~$5-15/month at low volume)

| Service | Tier | Cost |
|---------|------|------|
| Azure Functions | Consumption Plan | ~$0 (1M free executions/month) |
| Azure Queue Storage | Standard | ~$0.01/month |
| Azure Key Vault | Standard | ~$0.03/10K operations |
| Application Insights | Free tier (5GB/month) | ~$0 |

### AI Costs (per bug)

| Scenario | Estimated Cost |
|----------|---------------|
| Simple fix (Sonnet only) | ~$0.30 |
| Complex fix (more exploration) | ~$1.05 |
| Escalation to Opus | ~$2.00-3.00 |
| **Budget cap per work item** | **$2.00 default** |

At 5 work items/week (~20/month): **$6-20/month in AI costs**.

---

## Monitoring

### Health check

```bash
curl https://<your-function-app>.azurewebsites.net/api/health-check
```

Returns `200` with `{"status": "healthy", ...}` or `503` with `{"status": "unhealthy", ...}`.

### Dashboard

```bash
curl https://<your-function-app>.azurewebsites.net/api/dashboard
```

Returns aggregated metrics:

```json
{
  "totalJobs": 42,
  "successCount": 28,
  "failureCount": 8,
  "noChangesCount": 5,
  "inProgressCount": 1,
  "recentJobs": [...]
}
```

### Application Insights

If `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, all logs, metrics, and events are sent to Application Insights. Key metrics tracked:

- `processing_duration_ms` — total time from dequeue to PR creation
- `agent_cost_usd` — Claude API cost per work item
- `agent_turns` — number of reasoning turns used

Key events: `bug_received`, `bug_processing_started`, `pr_created`, `model_escalated`, `pr_retry_enqueued`.

---

## Project Structure

```
review-syndrome/
├── src/
│   ├── functions/              # Azure Function endpoints
│   │   ├── webhook-handler.ts
│   │   ├── bug-fix-worker.ts
│   │   ├── pr-status-handler.ts
│   │   ├── pr-retry-worker.ts
│   │   ├── health-check.ts
│   │   └── dashboard.ts
│   └── shared/                 # Core logic
│       ├── types.ts
│       ├── config.ts
│       ├── pipeline.ts
│       ├── agent-runner.ts
│       ├── azure-devops-client.ts
│       ├── git-operations.ts
│       ├── prompt-builder.ts
│       ├── job-tracker.ts
│       ├── logger.ts
│       └── retry.ts
├── tests/                      # Vitest test suites (100 tests)
├── config/
│   └── config.json             # Per-project configuration
├── infra/                      # Bicep IaC templates
│   ├── main.bicep
│   ├── parameters.json
│   └── modules/
│       ├── function-app.bicep
│       ├── storage.bicep
│       └── key-vault.bicep
├── package.json
├── tsconfig.json
├── host.json                   # Azure Functions host config
├── .env.example
└── PRD.md
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `func start` fails with "no functions found" | Run `npm run build` first. Functions are loaded from `dist/` |
| Queue messages not being processed | Ensure Azurite is running and `AzureWebJobsStorage=UseDevelopmentStorage=true` is set |
| "Missing required environment variable" error | Check `local.settings.json` has all required values under `Values` |
| Agent makes no changes | The work item may be too vague. Add detailed repro steps and description, then re-trigger |
| PAT authentication fails | Verify your PAT has Code (Read & Write) and Work Items (Read & Write) scopes |
| Webhook not firing | Verify the service hook is active in Azure DevOps Project Settings > Service Hooks |
| Build errors with ESM imports | This project uses ES modules. Ensure `"type": "module"` is in package.json |

---

## License

Private — not for distribution.
