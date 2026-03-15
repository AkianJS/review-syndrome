export interface JobRecord {
  workItemId: number;
  status: "in-progress" | "success" | "failure" | "no-changes";
  startedAt: string;
  completedAt?: string;
  prId?: number;
  retryCount?: number;
  costUsd?: number;
  durationMs?: number;
  modelUsed?: string;
  escalated?: boolean;
  projectName?: string;
}

export interface DashboardStats {
  totalJobs: number;
  successCount: number;
  failureCount: number;
  noChangesCount: number;
  inProgressCount: number;
  totalCostUsd: number;
  avgCostUsd: number;
  escalationCount: number;
  recentJobs: JobRecord[];
}

export interface HealthCheckResult {
  status: "healthy" | "unhealthy";
  checks: Record<string, { status: "pass" | "fail"; message?: string }>;
}
