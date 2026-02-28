# ReviewSyndrome Agent — Product Requirements Document

## 1. Overview

**ReviewSyndrome Agent** is an autonomous AI-powered system that automatically fixes bugs reported in Azure DevOps. When a new Bug work item is created, the agent receives a webhook notification, clones the relevant repository, analyzes the codebase, generates a fix using Claude AI, and creates a Pull Request in Azure Repos — all without human intervention.

The PR itself serves as the human review gate. Existing CI/CD pipelines validate the fix. Developers review and merge as they would any other PR.

### 1.1 Problem Statement

Developers spend significant time triaging, investigating, and creating initial fixes for bugs. Many bugs — especially regressions, null references, off-by-one errors, and missing validation — follow predictable patterns that an AI agent can resolve autonomously. By automating the "first pass" fix, developers can focus on reviewing and refining rather than starting from scratch.

### 1.2 Target Users

- Development teams using Azure DevOps (Boards + Repos + Pipelines)
- Teams with multiple technology stacks (C#, TypeScript, Python, etc.)
- Organizations that want to accelerate bug resolution without switching off Azure DevOps

### 1.3 What Makes This Different

| Existing Tool | Limitation |
|---|---|
| **Devin** | Azure DevOps support is Enterprise-only ($500+/mo), closed-source |
| **GitHub Copilot Coding Agent** | Requires GitHub repos, not Azure Repos |
| **SWE-agent / Aider / Sweep** | GitHub-only, no Azure DevOps integration |
| **OpenClaw** | No Azure DevOps integration, requires custom skill development |
| **CodeRabbit** | Azure DevOps support exists but for PR *review* only, not bug fixing |

**ReviewSyndrome Agent** is purpose-built for Azure DevOps end-to-end: Azure Boards (work items) → Azure Repos (code + PRs) → Azure Pipelines (CI validation).

---

## 2. Architecture

### 2.1 High-Level Flow

```
┌─────────────────┐     Webhook (HTTP POST)     ┌──────────────────────┐
│  Azure DevOps   │ ──────────────────────────▶  │  Azure Function      │
│  (Bug Created)  │                              │  (Webhook Handler)   │
└─────────────────┘                              └──────────┬───────────┘
                                                            │
                                                            │ Queue message
                                                            ▼
                                                 ┌──────────────────────┐
                                                 │  Azure Queue Storage │
                                                 └──────────┬───────────┘
                                                            │
                                                            │ Dequeue
                                                            ▼
                                                 ┌──────────────────────┐
                                                 │  Agent Worker        │
                                                 │  (Container Instance)│
                                                 │                      │
                                                 │  1. Fetch bug details│
                                                 │  2. Clone repo       │
                                                 │  3. Run Claude Agent │
                                                 │  4. Commit fix       │
                                                 │  5. Push branch      │
                                                 │  6. Create PR        │
                                                 └──────────────────────┘
                                                            │
                                                            ▼
                                                 ┌──────────────────────┐
                                                 │  Azure DevOps        │
                                                 │  - New branch        │
                                                 │  - Pull Request      │
                                                 │  - CI Pipeline runs  │
                                                 └──────────────────────┘
```

### 2.2 Components

#### Component 1: Webhook Handler (Azure Function)

- **Runtime**: Node.js 20 / TypeScript
- **Trigger**: HTTP POST from Azure DevOps Service Hook
- **Responsibility**:
  - Receive the `workitem.created` webhook payload
  - Validate the payload (check `eventType`, `workItemType === "Bug"`)
  - Extract work item ID, project name, and organization URL
  - Enqueue a message to Azure Queue Storage
  - Return `200 OK` immediately (Azure DevOps requires fast response)
- **Why a queue?**: The webhook handler must respond within seconds. The agent work takes minutes. Decoupling via a queue provides reliability (retries, dead-letter), scalability, and prevents webhook timeouts.

#### Component 2: Job Queue (Azure Queue Storage)

- **Service**: Azure Queue Storage (cheapest, simplest for this scale)
- **Message format**:
  ```json
  {
    "workItemId": 5,
    "projectName": "MyProject",
    "organizationUrl": "https://dev.azure.com/myorg",
    "timestamp": "2026-02-27T10:30:00Z"
  }
  ```
- **Visibility timeout**: 30 minutes (to allow the agent time to process)
- **Max dequeue count**: 3 (move to dead-letter/poison queue after 3 failures)
- **Future upgrade path**: Azure Service Bus if we need more sophisticated routing, priority queues, or deduplication

#### Component 3: Agent Worker (Azure Container Instance)

- **Runtime**: Node.js 20 / TypeScript in Docker container
- **Trigger**: Polls the queue (or event-driven via Azure Function queue trigger)
- **Core library**: `@anthropic-ai/claude-agent-sdk`
- **Model**: Claude Sonnet (`claude-sonnet-4-6`)
- **Responsibility** (sequential pipeline):

  **Step 1 — Fetch Bug Details**
  ```
  GET /_{project}/_apis/wit/workitems/{id}?$expand=All&api-version=7.1
  GET /_{project}/_apis/wit/workItems/{id}/comments?api-version=7.1-preview.4
  ```
  Extract: title, description, repro steps, severity, priority, system info, comments, attachments, related work items.

  **Step 2 — Determine Repository**
  Use project name to look up the default repository:
  ```
  GET /_{project}/_apis/git/repositories?api-version=7.1
  ```
  Select the first/default repository (single repo per project model).

  **Step 3 — Clone Repository**
  Clone the repo to a temporary working directory using git + PAT authentication:
  ```bash
  git clone https://{PAT}@dev.azure.com/{org}/{project}/_git/{repo} /tmp/work/{jobId}
  ```

  **Step 4 — Run Claude Agent**
  Invoke the Claude Agent SDK with:
  - A structured prompt containing all bug details
  - The cloned repo as the working directory
  - Allowed tools: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash`
  - Budget limit: `--max-budget-usd` (configurable, default $2 per bug)
  - Turn limit: `--max-turns` (configurable, default 50)
  - System prompt with instructions: analyze the bug, locate the relevant code, understand the root cause, implement a minimal fix, do not refactor unrelated code

  **Step 5 — Validate Output**
  Check that the agent actually made file changes (`git diff`). If no changes were made, log a failure and skip PR creation.

  **Step 6 — Create Branch & Push**
  ```bash
  git checkout -b bugfix/wi-{workItemId}-{sanitized-title}
  git add -A
  git commit -m "fix: {bug title} (WI #{workItemId})"
  git push origin bugfix/wi-{workItemId}-{sanitized-title}
  ```

  **Step 7 — Create Pull Request**
  ```
  POST /_{project}/_apis/git/repositories/{repoId}/pullrequests?api-version=7.1
  ```
  Body:
  ```json
  {
    "sourceRefName": "refs/heads/bugfix/wi-{workItemId}-{title}",
    "targetRefName": "refs/heads/main",
    "title": "Fix: {bug title} (WI #{workItemId})",
    "description": "## Automated Fix by ReviewSyndrome Agent\n\n**Bug**: #{workItemId} — {title}\n**Severity**: {severity}\n\n### Root Cause Analysis\n{agent's analysis}\n\n### Changes Made\n{summary of changes}\n\n---\n*This PR was automatically generated. Please review carefully before merging.*",
    "workItemRefs": [{ "id": "{workItemId}" }]
  }
  ```

  **Step 8 — Cleanup**
  Delete the temporary working directory. Delete the message from the queue.

### 2.3 Infrastructure Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Azure Subscription                       │
│                                                                 │
│  ┌─────────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Azure Function   │───▶│ Queue Storage │───▶│ Container     │  │
│  │ (Webhook)        │    │              │    │ Instance      │  │
│  │ Consumption Plan │    │ Standard     │    │ (Agent Worker)│  │
│  └─────────────────┘    └──────────────┘    └───────┬───────┘  │
│           │                                          │          │
│           │              ┌──────────────┐            │          │
│           │              │ Key Vault    │────────────┘          │
│           │              │ (Secrets)    │                       │
│           │              └──────────────┘                       │
│           │                                                     │
│           │              ┌──────────────┐                       │
│           └─────────────▶│ App Insights │◀──────────────────────│
│                          │ (Logging)    │                       │
│                          └──────────────┘                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
           │                                          │
           ▼                                          ▼
┌─────────────────┐                        ┌─────────────────┐
│ Azure DevOps    │                        │ Anthropic API   │
│ (Boards + Repos)│                        │ (Claude Sonnet) │
└─────────────────┘                        └─────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Justification |
|---|---|---|
| **Language** | TypeScript (Node.js 20) | First-class Claude Agent SDK support, strong Azure SDK ecosystem |
| **Webhook Handler** | Azure Functions v4 | Serverless, auto-scale, pay-per-execution, fast cold start |
| **Job Queue** | Azure Queue Storage | Simplest and cheapest. Upgrade to Service Bus if needed |
| **Agent Worker** | Azure Container Instances | On-demand containers, pay-per-second, sufficient for low-to-medium volume |
| **AI Engine** | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) | Full Claude Code capabilities as a library — file reading, editing, code search, bash execution |
| **AI Model** | Claude Sonnet 4.6 (`claude-sonnet-4-6`) | Best cost/quality for code tasks. ~$3/$15 per M tokens |
| **Secrets** | Azure Key Vault | Store PATs, API keys, connection strings securely |
| **Logging** | Azure Application Insights | Structured logging, metrics, alerting |
| **Container Registry** | Azure Container Registry | Store the agent worker Docker image |
| **IaC** | Bicep or Terraform | Infrastructure as Code for reproducible deployments |

---

## 4. Detailed Specifications

### 4.1 Webhook Payload Handling

The Azure DevOps Service Hook sends a `workitem.created` event. The webhook handler:

1. **Validates** the request:
   - Checks `eventType === "workitem.created"`
   - Checks `resource.fields["System.WorkItemType"] === "Bug"`
   - Optionally validates a shared secret/HMAC signature (if configured in service hook headers)

2. **Extracts** the essential data:
   - `workItemId`: `resource.id`
   - `projectName`: `resource.fields["System.TeamProject"]`
   - `organizationUrl`: derived from `resource.url` or configured as environment variable

3. **Enqueues** the job and returns `200 OK`

4. **Idempotency**: Uses `workItemId` as deduplication key. If a message for the same work item is already in the queue or being processed, skip it.

### 4.2 Claude Agent Prompt Engineering

The prompt sent to the Claude Agent SDK is critical for quality. Structure:

```
You are ReviewSyndrome Agent, an autonomous bug-fixing assistant.

## Bug Report
- **ID**: #{workItemId}
- **Title**: {title}
- **Severity**: {severity}
- **Priority**: {priority}
- **Description**: {description}
- **Repro Steps**: {reproSteps}
- **System Info**: {systemInfo}
- **Comments**: {comments}
- **Related Work Items**: {relatedItems}

## Instructions
1. Analyze the bug report carefully. Understand what the expected behavior is vs actual behavior.
2. Search the codebase to locate the relevant files and code paths.
3. Identify the root cause of the bug.
4. Implement a minimal, focused fix. Do NOT refactor unrelated code. Do NOT add features.
5. If the bug involves a test failure or can be validated with a test, add or update a test.
6. If you cannot confidently identify or fix the bug, make no changes and explain why.

## Constraints
- Only modify files directly related to the bug fix.
- Follow the existing code style and conventions.
- Do not modify configuration files, CI/CD pipelines, or infrastructure code.
- Do not add new dependencies unless absolutely necessary for the fix.
- Keep changes as small as possible.
```

### 4.3 Agent SDK Configuration

```typescript
import { query, ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";

const options: ClaudeAgentOptions = {
  model: "claude-sonnet-4-6",
  allowed_tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  max_turns: 50,
  max_budget_usd: 2.0,
  permission_mode: "acceptEdits", // Auto-approve file reads/edits
  cwd: "/tmp/work/{jobId}",      // Working directory = cloned repo
  append_system_prompt: "...",    // The bug context prompt above
};

for await (const message of query({ prompt, options })) {
  // Stream and log agent progress
  logger.info({ message });
}
```

### 4.4 Branch Naming Convention

```
bugfix/wi-{workItemId}-{sanitized-title}
```

Examples:
- `bugfix/wi-1234-login-button-crash`
- `bugfix/wi-5678-null-ref-in-payment`

Sanitization rules:
- Lowercase
- Replace spaces and special characters with hyphens
- Truncate to 50 characters max (branch name portion)
- Remove trailing hyphens

### 4.5 PR Description Template

```markdown
## Automated Fix by ReviewSyndrome Agent

**Bug**: [#{workItemId} — {title}]({workItemUrl})
**Severity**: {severity} | **Priority**: {priority}

### Root Cause Analysis
{agent's analysis of the root cause}

### Changes Made
{summary of files changed and what was fixed}

### Files Modified
{list of files with brief description of changes}

---

> This PR was automatically generated by **ReviewSyndrome Agent** using Claude Sonnet.
> Please review carefully before merging.
> AI-generated cost: ~${costEstimate}
```

### 4.6 Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| Agent can't find the bug's root cause | Log failure, do NOT create PR. Optionally add comment to work item: "Unable to automatically fix this bug." |
| Agent makes no file changes | Log warning, skip PR creation |
| Clone fails (auth, network) | Retry up to 3 times with exponential backoff, then dead-letter |
| Claude API rate limit / error | Retry with exponential backoff (max 3 attempts) |
| Budget exceeded mid-analysis | Agent stops gracefully; if partial changes exist, discard them |
| Duplicate webhook (same bug) | Idempotency check: skip if already processed |
| Branch already exists | Append a numeric suffix: `bugfix/wi-1234-login-crash-2` |
| PR creation fails | Log error, retain the branch for manual investigation |
| Repository is empty | Skip processing, log warning |

### 4.7 Security Considerations

| Concern | Mitigation |
|---|---|
| **PAT exposure** | Store in Azure Key Vault, never log, use managed identity to access Key Vault |
| **Anthropic API key** | Store in Azure Key Vault |
| **Agent code execution** | Agent runs in an isolated container with no network access to internal systems (only Azure DevOps + Anthropic API). Container is ephemeral — destroyed after each job |
| **Malicious bug descriptions** | The agent prompt includes guardrails. Claude's safety training prevents executing harmful commands. Bash tool should be restricted to read-only operations + git commands |
| **Credential leakage in commits** | Agent instructions explicitly prohibit modifying config files or adding credentials |
| **Supply chain** | Agent cannot add new dependencies. This is enforced in the prompt and can be validated post-fix |

### 4.8 Bash Tool Restrictions

For safety, restrict the Bash tool to specific patterns:

```typescript
allowed_tools: [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash(git *)",
  "Bash(npm test *)",
  "Bash(dotnet test *)",
  "Bash(python -m pytest *)",
  "Bash(ls *)",
  "Bash(cat *)",
  "Bash(find *)",
]
```

This prevents the agent from running arbitrary commands while allowing git operations, test execution, and file exploration.

---

## 5. Configuration

The system is configured via environment variables and a configuration file.

### 5.1 Environment Variables

| Variable | Description | Example |
|---|---|---|
| `AZURE_DEVOPS_ORG_URL` | Azure DevOps organization URL | `https://dev.azure.com/myorg` |
| `AZURE_DEVOPS_PAT` | Personal Access Token (from Key Vault) | `***` |
| `ANTHROPIC_API_KEY` | Claude API key (from Key Vault) | `sk-ant-***` |
| `AZURE_STORAGE_CONNECTION` | Queue Storage connection string | `DefaultEndpointsProtocol=...` |
| `QUEUE_NAME` | Queue name | `bug-fix-jobs` |
| `TARGET_BRANCH` | Default target branch for PRs | `main` |
| `MAX_BUDGET_PER_BUG` | Max Claude API cost per bug (USD) | `2.00` |
| `MAX_AGENT_TURNS` | Max agent reasoning turns | `50` |
| `LOG_LEVEL` | Logging verbosity | `info` |

### 5.2 Project Configuration File (`config.json`)

```json
{
  "projects": {
    "MyProject": {
      "defaultBranch": "main",
      "repository": null,
      "agentModel": "claude-sonnet-4-6",
      "maxBudget": 2.0,
      "maxTurns": 50,
      "enabled": true
    }
  },
  "globalDefaults": {
    "defaultBranch": "main",
    "agentModel": "claude-sonnet-4-6",
    "maxBudget": 2.0,
    "maxTurns": 50
  }
}
```

---

## 6. Project Structure

```
review-syndrome/
├── src/
│   ├── functions/
│   │   └── webhook-handler.ts         # Azure Function: HTTP trigger
│   ├── worker/
│   │   ├── index.ts                   # Worker entry point (queue consumer)
│   │   ├── agent-runner.ts            # Claude Agent SDK orchestration
│   │   ├── azure-devops-client.ts     # Azure DevOps REST API wrapper
│   │   ├── git-operations.ts          # Clone, branch, commit, push
│   │   └── prompt-builder.ts          # Construct agent prompt from bug data
│   ├── shared/
│   │   ├── config.ts                  # Configuration loading
│   │   ├── logger.ts                  # Application Insights logger
│   │   ├── queue-client.ts            # Azure Queue Storage client
│   │   └── types.ts                   # TypeScript interfaces
│   └── index.ts                       # Main exports
├── infra/
│   ├── main.bicep                     # Azure infrastructure (Bicep IaC)
│   ├── modules/
│   │   ├── function-app.bicep
│   │   ├── container-instance.bicep
│   │   ├── storage.bicep
│   │   └── key-vault.bicep
│   └── parameters.json
├── docker/
│   └── Dockerfile                     # Agent worker container image
├── config/
│   └── config.json                    # Project configuration
├── tests/
│   ├── webhook-handler.test.ts
│   ├── agent-runner.test.ts
│   ├── azure-devops-client.test.ts
│   └── prompt-builder.test.ts
├── package.json
├── tsconfig.json
├── .env.example
└── PRD.md
```

---

## 7. Implementation Phases

### Phase 1: Foundation (MVP)
**Goal**: End-to-end flow working for a single project.

1. Set up project scaffolding (TypeScript, ESLint, tests)
2. Implement Azure DevOps REST API client (fetch work item, create branch, create PR)
3. Implement webhook handler (Azure Function)
4. Implement queue producer/consumer
5. Implement Claude Agent SDK integration (agent-runner)
6. Implement prompt builder
7. Implement git operations (clone, branch, commit, push)
8. Wire up the full pipeline end-to-end
9. Deploy to Azure (Function + Container Instance + Queue)
10. Configure Azure DevOps Service Hook

**Deliverable**: A bug created in Azure DevOps triggers an automated PR within minutes.

### Phase 2: Reliability & Observability
**Goal**: Production-ready robustness.

1. Add Application Insights structured logging throughout
2. Add error handling, retries, and dead-letter queue processing
3. Add idempotency checks (prevent duplicate processing)
4. Add budget and turn limit enforcement
5. Add health check endpoint
6. Add basic metrics (bugs processed, PRs created, failure rate)
7. Infrastructure as Code (Bicep) for reproducible deployments

### Phase 3: Enhancements (Future)
**Goal**: Scale and improve quality.

1. Multi-project support with per-project configuration
2. Tiered model strategy (Sonnet → Opus fallback)
3. Work item comment updates (status reporting on the bug)
4. Support for bug updates as re-trigger (retry with new info)
5. Manual trigger via tag or comment (`@agent fix this`)
6. Dashboard for metrics and monitoring
7. Support for Azure Repos with multiple repos per project (area path mapping)
8. PR auto-retry when CI fails (agent iterates on the fix)

---

## 8. Cost Estimate

### Azure Infrastructure (Monthly)

| Service | Tier | Estimated Cost |
|---|---|---|
| Azure Functions | Consumption Plan | ~$0 (1M free executions/mo) |
| Azure Queue Storage | Standard | ~$0.01 |
| Azure Container Instances | On-demand, 2 vCPU / 4GB | ~$0.05/hour × hours used |
| Azure Key Vault | Standard | ~$0.03/10K operations |
| Azure Container Registry | Basic | ~$5/mo |
| Application Insights | Free tier (5GB/mo) | ~$0 |
| **Total infrastructure** | | **~$5-15/mo** (at low volume) |

### AI/LLM Costs (Per Bug)

| Model | Avg Input Tokens | Avg Output Tokens | Est. Cost/Bug |
|---|---|---|---|
| Claude Sonnet 4.6 | ~50K | ~10K | ~$0.30 |
| Complex bugs (more exploration) | ~200K | ~30K | ~$1.05 |
| Budget cap per bug | | | **$2.00 max** |

At 5 bugs/week ≈ 20 bugs/month: **$6-20/mo in AI costs**.

### Total Estimated Monthly Cost: **$11-35/mo** at low volume.

---

## 9. Success Metrics

| Metric | Target (Phase 1) | Target (Phase 2+) |
|---|---|---|
| **Fix Rate** | 20-30% of bugs get a valid fix | 40-50% |
| **PR Merge Rate** | 15-20% of generated PRs are merged | 30%+ |
| **Time to PR** | < 10 minutes from bug creation | < 5 minutes |
| **Cost per Bug** | < $2.00 average | < $1.00 |
| **False Positive Rate** | < 5% harmful/incorrect PRs | < 2% |
| **Uptime** | 95% | 99.5% |

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Agent produces incorrect fixes | Bad PRs waste reviewer time | Human code review is mandatory. PR description clearly labels as AI-generated. Track merge rate to measure quality. |
| Agent modifies unrelated code | Noise in PRs, harder to review | Strong prompt engineering constraining scope. Post-fix validation of diff size. |
| Cost overrun from complex bugs | Unexpected API bills | Hard budget cap per bug ($2). Daily/monthly spending alerts. |
| Prompt injection via bug description | Agent executes malicious instructions | Bash tool restrictions. Agent runs in isolated container. Claude's safety training. Input sanitization. |
| Azure DevOps API rate limits | Job processing delays | Exponential backoff. Queue provides natural rate limiting. |
| Repo contains secrets/sensitive data | Data exposure risk | Agent runs in private Azure infrastructure. No data leaves to third parties except Anthropic API (review their data policy). |

---

## 11. Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | latest | Claude Code as a library |
| `@azure/functions` | v4 | Azure Functions runtime |
| `@azure/storage-queue` | latest | Queue Storage client |
| `@azure/keyvault-secrets` | latest | Key Vault access |
| `@azure/identity` | latest | Azure authentication (Managed Identity) |
| `applicationinsights` | latest | Logging & telemetry |
| `simple-git` | latest | Git operations from Node.js |

---

## 12. Open Questions

1. **Anthropic Data Policy**: Does sending codebase content to the Anthropic API comply with your organization's data governance policies? Claude API has a zero-retention policy for API usage, but this should be verified with your security team.

2. **PAT vs Managed Identity**: Should we use a PAT or Azure Managed Identity (via Entra ID) for Azure DevOps API access? Managed Identity is more secure but requires more setup.

3. **Target Branch**: Is `main` always the target branch, or do some projects use `develop`, `master`, or release branches?

4. **PR Reviewers**: Should the PR be auto-assigned to specific reviewers? If so, how do we determine who?

5. **Agent Environment**: Does the agent container need specific SDKs installed (e.g., .NET SDK, Node.js, Python) to understand the codebase, or is Claude's analysis sufficient without building/running the code?
