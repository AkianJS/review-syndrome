import { query } from "@anthropic-ai/claude-agent-sdk";
import { AgentResult, Config } from "./types.js";

export async function runAgent(
  prompt: string,
  workDir: string,
  config: Config
): Promise<AgentResult> {
  let analysis = "";
  let costUsd = 0;

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
        },
      },
    })) {
      if ("result" in message) {
        analysis = message.result;
      }
      if ("costUsd" in message && typeof message.costUsd === "number") {
        costUsd = message.costUsd;
      }
    }

    return {
      success: analysis.length > 0,
      analysis,
      costUsd,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      analysis: `Agent failed: ${errorMessage}`,
      costUsd,
    };
  }
}
