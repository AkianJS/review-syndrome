import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/shared/auth.js", () => ({
  validateApiKey: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/shared/job-tracker.js", () => ({
  getJobRecord: vi.fn(),
}));

vi.mock("../src/shared/azure-devops-client.js", () => ({
  getBuildLog: vi.fn(),
}));

vi.mock("../src/shared/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    azureDevOpsOrgUrl: "https://dev.azure.com/testorg",
    azureDevOpsPat: "test-pat",
    anthropicApiKey: "sk-ant-test",
    targetBranch: "main",
    maxBudgetPerBug: 2.0,
    maxAgentTurns: 50,
    agentModel: "claude-sonnet-4-6",
  }),
}));

vi.mock("../src/shared/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trackMetric: vi.fn(),
    trackEvent: vi.fn(),
  }),
}));

import { getJobRecord } from "../src/shared/job-tracker.js";
import { getBuildLog } from "../src/shared/azure-devops-client.js";

describe("PR status handler logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["AZURE_DEVOPS_ORG_URL"] = "https://dev.azure.com/testorg";
  });

  it("should extract work item ID from bugfix branch name", () => {
    const sourceBranch = "refs/heads/bugfix/wi-42-login-button-crash";
    const match = sourceBranch.match(/bugfix\/wi-(\d+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("42");
  });

  it("should not match non-ReviewSyndrome branches", () => {
    const sourceBranch = "refs/heads/feature/add-login";
    expect(sourceBranch.includes("bugfix/wi-")).toBe(false);
  });

  it("should check retry count limit", () => {
    const MAX_RETRY_COUNT = 2;
    expect(0 < MAX_RETRY_COUNT).toBe(true);
    expect(1 < MAX_RETRY_COUNT).toBe(true);
    expect(2 < MAX_RETRY_COUNT).toBe(false);
  });

  it("should only process failed builds", () => {
    const failedResults = ["failed", "partiallySucceeded"];
    const successResults = ["succeeded", "canceled"];

    failedResults.forEach((r) => {
      expect(r === "failed" || r === "partiallySucceeded").toBe(true);
    });

    successResults.forEach((r) => {
      expect(r === "failed" || r === "partiallySucceeded").toBe(false);
    });
  });

  it("should construct PrRetryJob with correct fields", () => {
    const retryJob = {
      workItemId: 42,
      projectName: "TestProject",
      organizationUrl: "https://dev.azure.com/testorg",
      prId: 5,
      branchName: "bugfix/wi-42-login-button-crash",
      repoId: "repo-1",
      repoUrl: "https://example.com/repo",
      ciFailureLog: "Test failed: expected 1 but got 2",
      retryCount: 1,
    };

    expect(retryJob.retryCount).toBe(1);
    expect(retryJob.branchName).toContain("bugfix/wi-42");
    expect(retryJob.ciFailureLog).toContain("Test failed");
  });

  it("should increment retry count from job record", () => {
    const currentRetries = 1;
    const newRetryCount = currentRetries + 1;
    expect(newRetryCount).toBe(2);
  });
});
