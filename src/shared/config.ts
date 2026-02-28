import { Config } from "./types.js";

export function loadConfig(): Config {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };

  return {
    azureDevOpsOrgUrl: required("AZURE_DEVOPS_ORG_URL"),
    azureDevOpsPat: required("AZURE_DEVOPS_PAT"),
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    targetBranch: process.env["TARGET_BRANCH"] ?? "main",
    maxBudgetPerBug: parseFloat(process.env["MAX_BUDGET_PER_BUG"] ?? "2.00"),
    maxAgentTurns: parseInt(process.env["MAX_AGENT_TURNS"] ?? "50", 10),
    agentModel: process.env["AGENT_MODEL"] ?? "claude-sonnet-4-6",
  };
}
