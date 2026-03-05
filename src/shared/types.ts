export interface ImageAttachment {
  url: string;
  filename: string;
  localPath?: string;
  source: "inline" | "attachment";
}

export interface BugFixJob {
  workItemId: number;
  projectName: string;
  organizationUrl: string;
  timestamp: string;
  triggerType?: "created" | "updated";
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
  areaPath?: string;
  images?: ImageAttachment[];
}

export interface AgentResult {
  success: boolean;
  analysis: string;
  costUsd: number;
  turnsUsed: number;
  durationMs: number;
  modelUsed: string;
  escalated?: boolean;
}

export interface JobRecord {
  workItemId: number;
  status: "in-progress" | "success" | "failure" | "no-changes";
  startedAt: string;
  completedAt?: string;
  prId?: number;
  retryCount?: number;
}

export interface ProjectConfig {
  defaultBranch: string;
  agentModel: string;
  maxBudget: number;
  maxTurns: number;
  enabled: boolean;
  repoMapping?: Record<string, string>;
}

export interface ProjectsConfig {
  projects: Record<string, Partial<ProjectConfig>>;
  globalDefaults: ProjectConfig;
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
  repoMapping?: Record<string, string>;
}

export interface PrRetryJob {
  workItemId: number;
  projectName: string;
  organizationUrl: string;
  prId: number;
  branchName: string;
  repoId: string;
  repoUrl: string;
  ciFailureLog: string;
  retryCount: number;
}
