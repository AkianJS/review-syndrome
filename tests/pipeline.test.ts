import { describe, it, expect, vi, beforeEach } from "vitest";
import { BugFixJob, Config } from "../src/shared/types.js";

// Mock all dependencies before importing the module under test
vi.mock("../src/shared/azure-devops-client.js", () => ({
  getWorkItemDetails: vi.fn(),
  getRepositories: vi.fn(),
  createPullRequest: vi.fn(),
}));

vi.mock("../src/shared/git-operations.js", () => ({
  cloneRepo: vi.fn(),
  sanitizeBranchName: vi.fn(),
  hasChanges: vi.fn(),
  getChangeSummary: vi.fn(),
  createBranchAndCommit: vi.fn(),
  pushBranch: vi.fn(),
  cleanup: vi.fn(),
}));

vi.mock("../src/shared/prompt-builder.js", () => ({
  buildAgentPrompt: vi.fn(),
}));

vi.mock("../src/shared/agent-runner.js", () => ({
  runAgent: vi.fn(),
}));

import { processBugFixJob } from "../src/shared/pipeline.js";
import { getWorkItemDetails, getRepositories, createPullRequest } from "../src/shared/azure-devops-client.js";
import { cloneRepo, sanitizeBranchName, hasChanges, getChangeSummary, createBranchAndCommit, pushBranch, cleanup } from "../src/shared/git-operations.js";
import { buildAgentPrompt } from "../src/shared/prompt-builder.js";
import { runAgent } from "../src/shared/agent-runner.js";

const mockConfig: Config = {
  azureDevOpsOrgUrl: "https://dev.azure.com/testorg",
  azureDevOpsPat: "test-pat",
  anthropicApiKey: "sk-ant-test",
  targetBranch: "main",
  maxBudgetPerBug: 2.0,
  maxAgentTurns: 50,
  agentModel: "claude-sonnet-4-6",
};

const mockJob: BugFixJob = {
  workItemId: 42,
  projectName: "TestProject",
  organizationUrl: "https://dev.azure.com/testorg",
  timestamp: "2026-02-27T10:00:00Z",
};

describe("processBugFixJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should process a bug fix job end-to-end when agent makes changes", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue({
      id: 42,
      title: "Login button crash",
      description: "Crashes on click",
      reproSteps: "Click login",
      severity: "2 - High",
      priority: "1",
      systemInfo: "",
      comments: [],
      projectName: "TestProject",
      organizationUrl: "https://dev.azure.com/testorg",
    });

    vi.mocked(getRepositories).mockResolvedValue([
      { id: "repo-1", name: "TestRepo", remoteUrl: "https://dev.azure.com/testorg/TestProject/_git/TestRepo", defaultBranch: "main" },
    ]);

    vi.mocked(cloneRepo).mockResolvedValue({
      workDir: "/tmp/test-dir",
      git: {} as any,
    });

    vi.mocked(buildAgentPrompt).mockReturnValue("Test prompt");
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      analysis: "Fixed the null reference",
      costUsd: 0.42,
    });
    vi.mocked(hasChanges).mockResolvedValue(true);
    vi.mocked(sanitizeBranchName).mockReturnValue("bugfix/wi-42-login-button-crash");
    vi.mocked(getChangeSummary).mockResolvedValue("1 file changed, 2 insertions(+), 1 deletion(-)");
    vi.mocked(createBranchAndCommit).mockResolvedValue(undefined);
    vi.mocked(pushBranch).mockResolvedValue(undefined);
    vi.mocked(createPullRequest).mockResolvedValue({ pullRequestId: 1, url: "https://example.com/pr/1" });
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, mockConfig);

    expect(getWorkItemDetails).toHaveBeenCalledWith(42, "TestProject", mockConfig);
    expect(getRepositories).toHaveBeenCalledWith("TestProject", mockConfig);
    expect(cloneRepo).toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalled();
    expect(createBranchAndCommit).toHaveBeenCalled();
    expect(pushBranch).toHaveBeenCalled();
    expect(createPullRequest).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith("/tmp/test-dir");
  });

  it("should skip PR creation when agent makes no changes", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue({
      id: 42,
      title: "Minor issue",
      description: "Something",
      reproSteps: "",
      severity: "3 - Medium",
      priority: "2",
      systemInfo: "",
      comments: [],
      projectName: "TestProject",
      organizationUrl: "https://dev.azure.com/testorg",
    });

    vi.mocked(getRepositories).mockResolvedValue([
      { id: "repo-1", name: "TestRepo", remoteUrl: "https://example.com", defaultBranch: "main" },
    ]);

    vi.mocked(cloneRepo).mockResolvedValue({
      workDir: "/tmp/test-dir",
      git: {} as any,
    });

    vi.mocked(buildAgentPrompt).mockReturnValue("Test prompt");
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      analysis: "Analyzed but no fix needed",
      costUsd: 0.10,
    });
    vi.mocked(hasChanges).mockResolvedValue(false);
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, mockConfig);

    expect(createBranchAndCommit).not.toHaveBeenCalled();
    expect(pushBranch).not.toHaveBeenCalled();
    expect(createPullRequest).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
  });

  it("should skip PR creation when agent fails", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue({
      id: 42,
      title: "Hard bug",
      description: "Complex issue",
      reproSteps: "",
      severity: "1 - Critical",
      priority: "1",
      systemInfo: "",
      comments: [],
      projectName: "TestProject",
      organizationUrl: "https://dev.azure.com/testorg",
    });

    vi.mocked(getRepositories).mockResolvedValue([
      { id: "repo-1", name: "TestRepo", remoteUrl: "https://example.com", defaultBranch: "main" },
    ]);

    vi.mocked(cloneRepo).mockResolvedValue({
      workDir: "/tmp/test-dir",
      git: {} as any,
    });

    vi.mocked(buildAgentPrompt).mockReturnValue("Test prompt");
    vi.mocked(runAgent).mockResolvedValue({
      success: false,
      analysis: "Agent failed: could not identify root cause",
      costUsd: 0.50,
    });
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, mockConfig);

    expect(hasChanges).not.toHaveBeenCalled();
    expect(createPullRequest).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
  });

  it("should throw when no repositories found", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue({
      id: 42,
      title: "Some bug",
      description: "",
      reproSteps: "",
      severity: "3 - Medium",
      priority: "2",
      systemInfo: "",
      comments: [],
      projectName: "EmptyProject",
      organizationUrl: "https://dev.azure.com/testorg",
    });

    vi.mocked(getRepositories).mockResolvedValue([]);
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await expect(processBugFixJob(mockJob, mockConfig)).rejects.toThrow(
      "No repositories found"
    );
  });
});
