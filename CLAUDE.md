# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This

ReviewSyndrome is an autonomous AI agent built as an Azure Functions v4 app (Node.js 20, ESM). It watches Azure DevOps work items tagged `ai-fix`, uses Claude Agent SDK to analyze bugs, writes code fixes in a cloned repo, and opens PRs for human review. A secondary flow auto-retries when CI fails on its PRs.

## Commands

```bash
npm run build        # TypeScript compile (tsc) → dist/
npm run start        # Build + start Azure Functions locally (requires Azurite for storage)
npm test             # Vitest single run
npm run test:watch   # Vitest watch mode
npx vitest run tests/pipeline.test.ts          # Run a single test file
npx vitest run -t "should process bug fix"     # Run a single test by name
```

Local dev requires Azurite running for queue/table storage emulation, and env vars in `local.settings.json` (`AZURE_DEVOPS_ORG_URL`, `AZURE_DEVOPS_PAT`, `ANTHROPIC_API_KEY`).

## Architecture

### Request Flow

```
ADO webhook → webhook-handler (HTTP) → [bug-fix-jobs queue] → bug-fix-worker → pipeline.ts
ADO build webhook → pr-status-handler (HTTP) → [pr-retry-jobs queue] → pr-retry-worker
```

Webhooks respond immediately; all heavy work is async via Azure Storage Queues.

### Key Directories

- `src/functions/` — Azure Function triggers (HTTP endpoints + queue workers)
- `src/shared/` — Core logic: pipeline orchestration, ADO client, git ops, agent runner, prompt builder, job tracker, retry, logger
- `tests/` — Vitest tests (all mocked, no real I/O)
- `config/` — Per-project config overrides (`config.json`)
- `infra/` — Azure Bicep IaC (Function App, Storage, Key Vault, App Insights)

### Core Pipeline (`src/shared/pipeline.ts`)

1. Idempotency check via atomic Azure Table Storage write (409 = already claimed)
2. Fetch work item details from ADO API
3. Select and clone target repo
4. Build prompt and run Claude Agent SDK (`agent-runner.ts`)
5. If agent fails on Sonnet, auto-escalate to Opus
6. If changes detected: create branch (`bugfix/wi-{id}-{slug}`), commit, push, create PR
7. Comment status back on the work item

### Important Patterns

- **Agent tool allowlist**: The Claude Agent is restricted to `Read`, `Edit`, `Write`, `Glob`, `Grep`, and specific Bash commands (`git *`, `npm test *`, `dotnet test *`, `python -m pytest *`, `ls *`)
- **Branch naming convention**: `bugfix/wi-{workItemId}-{slug}` — the `wi-` prefix is how `pr-status-handler` identifies ReviewSyndrome branches in build webhooks
- **PAT injection**: Git auth is done by injecting the PAT into the clone URL username
- **Re-trigger**: Updating a work item (tag, description, or `@agent fix this` comment) deletes the Table Storage record via `resetJob()` to allow reprocessing
- **Queue settings**: `batchSize: 1` (one job at a time), `visibilityTimeout: 30min`, `maxDequeueCount: 3` (then poison queue)

## Testing

All tests use `vi.mock()` to stub external dependencies. No integration tests exist — everything is unit-tested with mocked ADO client, git operations, agent SDK, and Azure Table Storage.

## Infrastructure

Bicep templates in `infra/` deploy: Function App (Consumption Plan, Linux), Storage Account (queues + table), Key Vault (PAT + API key via managed identity), App Insights.
