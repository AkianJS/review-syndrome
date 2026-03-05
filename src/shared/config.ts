import { readFileSync } from "fs";
import { join } from "path";
import { Config, ProjectsConfig } from "./types.js";

export function loadConfig(projectName?: string): Config {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };

  const baseConfig: Config = {
    azureDevOpsOrgUrl: required("AZURE_DEVOPS_ORG_URL"),
    azureDevOpsPat: required("AZURE_DEVOPS_PAT"),
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    targetBranch: process.env["TARGET_BRANCH"] ?? "main",
    maxBudgetPerBug: parseFloat(process.env["MAX_BUDGET_PER_BUG"] ?? "2.00"),
    maxAgentTurns: parseInt(process.env["MAX_AGENT_TURNS"] ?? "50", 10),
    agentModel: process.env["AGENT_MODEL"] ?? "claude-sonnet-4-6",
  };

  // Apply project-specific overrides if available
  // Only override env-var values when a project-specific (not globalDefaults) config exists
  if (projectName) {
    const projectConfig = loadProjectConfig(projectName);
    if (projectConfig) {
      if (projectConfig.defaultBranch && !process.env["TARGET_BRANCH"]) baseConfig.targetBranch = projectConfig.defaultBranch;
      if (projectConfig.agentModel && !process.env["AGENT_MODEL"]) baseConfig.agentModel = projectConfig.agentModel;
      if (projectConfig.maxBudget !== undefined && !process.env["MAX_BUDGET_PER_BUG"]) baseConfig.maxBudgetPerBug = projectConfig.maxBudget;
      if (projectConfig.maxTurns !== undefined && !process.env["MAX_AGENT_TURNS"]) baseConfig.maxAgentTurns = projectConfig.maxTurns;
      if (projectConfig.repoMapping) baseConfig.repoMapping = projectConfig.repoMapping;
    }
  }

  return baseConfig;
}

function loadProjectConfig(
  projectName: string
): Partial<{ defaultBranch: string; agentModel: string; maxBudget: number; maxTurns: number; enabled: boolean; repoMapping: Record<string, string> }> | undefined {
  try {
    const configPath = join(process.cwd(), "config", "config.json");
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as ProjectsConfig;

    const projectOverrides = config.projects[projectName];
    if (projectOverrides) {
      return { ...config.globalDefaults, ...projectOverrides };
    }

    return config.globalDefaults;
  } catch {
    return undefined;
  }
}
