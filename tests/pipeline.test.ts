import { describe, it, expect, vi, beforeEach } from "vitest";
import { BugFixJob, Config } from "../src/shared/types.js";

// Mock all dependencies before importing the module under test
vi.mock("../src/shared/azure-devops-client.js", () => ({
  getWorkItemDetails: vi.fn(),
  getRepositories: vi.fn(),
  createPullRequest: vi.fn(),
  addWorkItemComment: vi.fn(),
  downloadWorkItemImages: vi.fn(),
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

vi.mock("../src/shared/job-tracker.js", () => ({
  markJobStarted: vi.fn().mockResolvedValue(true),
  markJobCompleted: vi.fn().mockResolvedValue(undefined),
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

import { processBugFixJob } from "../src/shared/pipeline.js";
import { getWorkItemDetails, getRepositories, createPullRequest, addWorkItemComment, downloadWorkItemImages } from "../src/shared/azure-devops-client.js";
import { cloneRepo, sanitizeBranchName, hasChanges, getChangeSummary, createBranchAndCommit, pushBranch, cleanup } from "../src/shared/git-operations.js";
import { buildAgentPrompt } from "../src/shared/prompt-builder.js";
import { runAgent } from "../src/shared/agent-runner.js";
import { markJobStarted, markJobCompleted } from "../src/shared/job-tracker.js";

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

const mockWorkItem = {
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
};

describe("processBugFixJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markJobStarted).mockResolvedValue(true);
    vi.mocked(markJobCompleted).mockResolvedValue(undefined);
    vi.mocked(addWorkItemComment).mockResolvedValue(undefined);
  });

  it("should process a bug fix job end-to-end when agent makes changes", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue(mockWorkItem);

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
      turnsUsed: 10,
      durationMs: 5000,
      modelUsed: "claude-sonnet-4-6",
    });
    vi.mocked(hasChanges).mockResolvedValue(true);
    vi.mocked(sanitizeBranchName).mockReturnValue("bugfix/wi-42-login-button-crash");
    vi.mocked(getChangeSummary).mockResolvedValue("1 file changed, 2 insertions(+), 1 deletion(-)");
    vi.mocked(createBranchAndCommit).mockResolvedValue(undefined);
    vi.mocked(pushBranch).mockResolvedValue(undefined);
    vi.mocked(createPullRequest).mockResolvedValue({ pullRequestId: 1, url: "https://example.com/pr/1" });
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, mockConfig);

    expect(markJobStarted).toHaveBeenCalledWith(42);
    expect(getWorkItemDetails).toHaveBeenCalledWith(42, "TestProject", mockConfig);
    expect(getRepositories).toHaveBeenCalledWith("TestProject", mockConfig);
    expect(cloneRepo).toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalled();
    expect(createBranchAndCommit).toHaveBeenCalled();
    expect(pushBranch).toHaveBeenCalled();
    expect(createPullRequest).toHaveBeenCalled();
    expect(markJobCompleted).toHaveBeenCalledWith(42, "success", 1);
    expect(addWorkItemComment).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith("/tmp/test-dir");
  });

  it("should skip PR creation when agent makes no changes", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue({
      ...mockWorkItem,
      title: "Minor issue",
      description: "Something",
      severity: "3 - Medium",
      priority: "2",
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
      turnsUsed: 5,
      durationMs: 2000,
      modelUsed: "claude-sonnet-4-6",
    });
    vi.mocked(hasChanges).mockResolvedValue(false);
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, mockConfig);

    expect(createBranchAndCommit).not.toHaveBeenCalled();
    expect(pushBranch).not.toHaveBeenCalled();
    expect(createPullRequest).not.toHaveBeenCalled();
    expect(markJobCompleted).toHaveBeenCalledWith(42, "no-changes");
    expect(cleanup).toHaveBeenCalled();
  });

  it("should skip PR creation when agent fails", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue({
      ...mockWorkItem,
      title: "Hard bug",
      description: "Complex issue",
      severity: "1 - Critical",
    });

    vi.mocked(getRepositories).mockResolvedValue([
      { id: "repo-1", name: "TestRepo", remoteUrl: "https://example.com", defaultBranch: "main" },
    ]);

    vi.mocked(cloneRepo).mockResolvedValue({
      workDir: "/tmp/test-dir",
      git: {} as any,
    });

    vi.mocked(buildAgentPrompt).mockReturnValue("Test prompt");
    // First call (Sonnet) fails, second call (Opus) also fails
    vi.mocked(runAgent)
      .mockResolvedValueOnce({
        success: false,
        analysis: "Agent failed: could not identify root cause",
        costUsd: 0.50,
        turnsUsed: 20,
        durationMs: 10000,
        modelUsed: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        success: false,
        analysis: "Opus also failed",
        costUsd: 1.00,
        turnsUsed: 30,
        durationMs: 15000,
        modelUsed: "claude-opus-4-6",
      });
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, mockConfig);

    // Should have been called twice (Sonnet then Opus)
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(hasChanges).not.toHaveBeenCalled();
    expect(createPullRequest).not.toHaveBeenCalled();
    expect(markJobCompleted).toHaveBeenCalledWith(42, "failure");
    expect(cleanup).toHaveBeenCalled();
  });

  it("should throw when no repositories found", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue({
      ...mockWorkItem,
      title: "Some bug",
      description: "",
      projectName: "EmptyProject",
    });

    vi.mocked(getRepositories).mockResolvedValue([]);
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await expect(processBugFixJob(mockJob, mockConfig)).rejects.toThrow(
      "No repositories found"
    );
  });

  it("should skip processing when job is already claimed", async () => {
    vi.mocked(markJobStarted).mockResolvedValue(false);

    await processBugFixJob(mockJob, mockConfig);

    expect(getWorkItemDetails).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("should escalate to Opus when Sonnet fails and succeed", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue(mockWorkItem);

    vi.mocked(getRepositories).mockResolvedValue([
      { id: "repo-1", name: "TestRepo", remoteUrl: "https://example.com", defaultBranch: "main" },
    ]);

    vi.mocked(cloneRepo).mockResolvedValue({
      workDir: "/tmp/test-dir",
      git: {} as any,
    });

    vi.mocked(buildAgentPrompt).mockReturnValue("Test prompt");
    // First call (Sonnet) fails, second call (Opus) succeeds
    vi.mocked(runAgent)
      .mockResolvedValueOnce({
        success: false,
        analysis: "Sonnet could not fix",
        costUsd: 0.30,
        turnsUsed: 15,
        durationMs: 8000,
        modelUsed: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        success: true,
        analysis: "Fixed with Opus",
        costUsd: 0.80,
        turnsUsed: 25,
        durationMs: 12000,
        modelUsed: "claude-opus-4-6",
      });

    vi.mocked(hasChanges).mockResolvedValue(true);
    vi.mocked(sanitizeBranchName).mockReturnValue("bugfix/wi-42-login-button-crash");
    vi.mocked(getChangeSummary).mockResolvedValue("2 files changed");
    vi.mocked(createBranchAndCommit).mockResolvedValue(undefined);
    vi.mocked(pushBranch).mockResolvedValue(undefined);
    vi.mocked(createPullRequest).mockResolvedValue({ pullRequestId: 5, url: "https://example.com/pr/5" });
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, mockConfig);

    expect(runAgent).toHaveBeenCalledTimes(2);
    // Second call should use Opus config
    expect(runAgent).toHaveBeenLastCalledWith(
      "Test prompt",
      "/tmp/test-dir",
      expect.objectContaining({ agentModel: "claude-opus-4-6" })
    );
    expect(createPullRequest).toHaveBeenCalled();
    expect(markJobCompleted).toHaveBeenCalledWith(42, "success", 5);
  });

  it("should not escalate when already using Opus", async () => {
    const opusConfig = { ...mockConfig, agentModel: "claude-opus-4-6" };

    vi.mocked(getWorkItemDetails).mockResolvedValue(mockWorkItem);
    vi.mocked(getRepositories).mockResolvedValue([
      { id: "repo-1", name: "TestRepo", remoteUrl: "https://example.com", defaultBranch: "main" },
    ]);
    vi.mocked(cloneRepo).mockResolvedValue({ workDir: "/tmp/test-dir", git: {} as any });
    vi.mocked(buildAgentPrompt).mockReturnValue("Test prompt");
    vi.mocked(runAgent).mockResolvedValue({
      success: false,
      analysis: "Opus could not fix",
      costUsd: 1.00,
      turnsUsed: 30,
      durationMs: 15000,
      modelUsed: "claude-opus-4-6",
    });
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, opusConfig);

    // Should only be called once — no escalation from Opus
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(markJobCompleted).toHaveBeenCalledWith(42, "failure");
  });

  it("should download images when work item has images", async () => {
    const imagesWorkItem = {
      ...mockWorkItem,
      images: [
        { url: "https://example.com/img1.png", filename: "screenshot.png", source: "inline" as const },
      ],
    };

    vi.mocked(getWorkItemDetails).mockResolvedValue(imagesWorkItem);
    vi.mocked(getRepositories).mockResolvedValue([
      { id: "repo-1", name: "TestRepo", remoteUrl: "https://example.com", defaultBranch: "main" },
    ]);
    vi.mocked(cloneRepo).mockResolvedValue({ workDir: "/tmp/test-dir", git: {} as any });
    vi.mocked(downloadWorkItemImages).mockResolvedValue([
      { url: "https://example.com/img1.png", filename: "screenshot.png", localPath: "/tmp/test-dir/.buginfo/images/inline-0-screenshot.png", source: "inline" },
    ]);
    vi.mocked(buildAgentPrompt).mockReturnValue("Test prompt");
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      analysis: "Fixed",
      costUsd: 0.40,
      turnsUsed: 10,
      durationMs: 5000,
      modelUsed: "claude-sonnet-4-6",
    });
    vi.mocked(hasChanges).mockResolvedValue(true);
    vi.mocked(sanitizeBranchName).mockReturnValue("bugfix/wi-42-login-button-crash");
    vi.mocked(getChangeSummary).mockResolvedValue("1 file changed");
    vi.mocked(createBranchAndCommit).mockResolvedValue(undefined);
    vi.mocked(pushBranch).mockResolvedValue(undefined);
    vi.mocked(createPullRequest).mockResolvedValue({ pullRequestId: 3, url: "https://example.com/pr/3" });
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, mockConfig);

    expect(downloadWorkItemImages).toHaveBeenCalledWith(
      [{ url: "https://example.com/img1.png", filename: "screenshot.png", source: "inline" }],
      "/tmp/test-dir",
      "test-pat"
    );
    // buildAgentPrompt should receive the work item with downloaded images (localPath set)
    expect(buildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          expect.objectContaining({ localPath: "/tmp/test-dir/.buginfo/images/inline-0-screenshot.png" }),
        ],
      })
    );
  });

  it("should not call downloadWorkItemImages when work item has no images", async () => {
    vi.mocked(getWorkItemDetails).mockResolvedValue(mockWorkItem); // no images
    vi.mocked(getRepositories).mockResolvedValue([
      { id: "repo-1", name: "TestRepo", remoteUrl: "https://example.com", defaultBranch: "main" },
    ]);
    vi.mocked(cloneRepo).mockResolvedValue({ workDir: "/tmp/test-dir", git: {} as any });
    vi.mocked(buildAgentPrompt).mockReturnValue("Test prompt");
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      analysis: "Fixed",
      costUsd: 0.40,
      turnsUsed: 10,
      durationMs: 5000,
      modelUsed: "claude-sonnet-4-6",
    });
    vi.mocked(hasChanges).mockResolvedValue(true);
    vi.mocked(sanitizeBranchName).mockReturnValue("bugfix/wi-42-login-button-crash");
    vi.mocked(getChangeSummary).mockResolvedValue("1 file changed");
    vi.mocked(createBranchAndCommit).mockResolvedValue(undefined);
    vi.mocked(pushBranch).mockResolvedValue(undefined);
    vi.mocked(createPullRequest).mockResolvedValue({ pullRequestId: 4, url: "https://example.com/pr/4" });
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, mockConfig);

    expect(downloadWorkItemImages).not.toHaveBeenCalled();
  });

  it("should select repo by area path when repoMapping is configured", async () => {
    const configWithMapping: Config = {
      ...mockConfig,
      repoMapping: {
        "TestProject\\Backend": "BackendRepo",
        "TestProject\\Frontend": "FrontendRepo",
      },
    };

    vi.mocked(getWorkItemDetails).mockResolvedValue({
      ...mockWorkItem,
      areaPath: "TestProject\\Backend",
    });

    vi.mocked(getRepositories).mockResolvedValue([
      { id: "repo-default", name: "DefaultRepo", remoteUrl: "https://example.com/default", defaultBranch: "main" },
      { id: "repo-backend", name: "BackendRepo", remoteUrl: "https://example.com/backend", defaultBranch: "main" },
      { id: "repo-frontend", name: "FrontendRepo", remoteUrl: "https://example.com/frontend", defaultBranch: "main" },
    ]);

    vi.mocked(cloneRepo).mockResolvedValue({ workDir: "/tmp/test-dir", git: {} as any });
    vi.mocked(buildAgentPrompt).mockReturnValue("Test prompt");
    vi.mocked(runAgent).mockResolvedValue({
      success: true,
      analysis: "Fixed",
      costUsd: 0.40,
      turnsUsed: 10,
      durationMs: 5000,
      modelUsed: "claude-sonnet-4-6",
    });
    vi.mocked(hasChanges).mockResolvedValue(true);
    vi.mocked(sanitizeBranchName).mockReturnValue("bugfix/wi-42-login-button-crash");
    vi.mocked(getChangeSummary).mockResolvedValue("1 file changed");
    vi.mocked(createBranchAndCommit).mockResolvedValue(undefined);
    vi.mocked(pushBranch).mockResolvedValue(undefined);
    vi.mocked(createPullRequest).mockResolvedValue({ pullRequestId: 2, url: "https://example.com/pr/2" });
    vi.mocked(cleanup).mockResolvedValue(undefined);

    await processBugFixJob(mockJob, configWithMapping);

    // Should clone the BackendRepo URL, not the default
    expect(cloneRepo).toHaveBeenCalledWith("https://example.com/backend", "test-pat");
  });
});
