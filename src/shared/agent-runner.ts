import { query } from "@anthropic-ai/claude-agent-sdk";
import { AgentResult, Config } from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("Agent");

export async function runAgent(
  prompt: string,
  workDir: string,
  config: Config
): Promise<AgentResult> {
  let analysis = "";
  let costUsd = 0;
  let turnsUsed = 0;
  const startTime = Date.now();

  logger.info("Starting Claude agent", {
    step: "agentStart",
    model: config.agentModel,
    maxTurns: config.maxAgentTurns,
    maxBudget: config.maxBudgetPerBug,
  });

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: workDir,
        model: config.agentModel,
        allowedTools: [
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
        ],
        maxTurns: config.maxAgentTurns,
        maxBudgetUsd: config.maxBudgetPerBug,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        env: {
          ANTHROPIC_API_KEY: config.anthropicApiKey,
          PATH: process.env.PATH ?? "",
        },
      },
    })) {
      if ("result" in message) {
        analysis = message.result;
      }
      if ("costUsd" in message && typeof message.costUsd === "number") {
        costUsd = message.costUsd;
      }
      turnsUsed++;
    }

    const durationMs = Date.now() - startTime;

    logger.info("Agent completed", {
      step: "agentComplete",
      costUsd,
      turnsUsed,
      durationMs,
      hasResult: analysis.length > 0,
    });

    logger.trackMetric("agent_cost_usd", costUsd);
    logger.trackMetric("agent_turns", turnsUsed);
    logger.trackMetric("agent_duration_ms", durationMs);

    return {
      success: analysis.length > 0,
      analysis,
      costUsd,
      turnsUsed,
      durationMs,
      modelUsed: config.agentModel,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Agent failed", error instanceof Error ? error : undefined, {
      step: "agentError",
      durationMs,
      turnsUsed,
    });

    return {
      success: false,
      analysis: `Agent failed: ${errorMessage}`,
      costUsd,
      turnsUsed,
      durationMs,
      modelUsed: config.agentModel,
    };
  }
}
