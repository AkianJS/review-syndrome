export interface BugFixJob {
  workItemId: number;
  projectName: string;
  organizationUrl: string;
  timestamp: string;
}

export interface WorkItemDetails {
  id: number;
  title: string;
  description: string;
  reproSteps: string;
  severity: string;
  priority: string;
  systemInfo: string;
  comments: string[];
  projectName: string;
  organizationUrl: string;
}

export interface AgentResult {
  success: boolean;
  analysis: string;
  costUsd: number;
}

export interface PullRequestParams {
  sourceRefName: string;
  targetRefName: string;
  title: string;
  description: string;
  workItemId: number;
}

export interface Repository {
  id: string;
  name: string;
  remoteUrl: string;
  defaultBranch: string;
}

export interface Config {
  azureDevOpsOrgUrl: string;
  azureDevOpsPat: string;
  anthropicApiKey: string;
  targetBranch: string;
  maxBudgetPerBug: number;
  maxAgentTurns: number;
  agentModel: string;
}
