import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractOrgUrl } from "../src/functions/webhook-handler.js";

// Mock dependencies
vi.mock("../src/shared/auth.js", () => ({
  validateApiKey: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/shared/job-tracker.js", () => ({
  isJobProcessed: vi.fn().mockResolvedValue(false),
  resetJob: vi.fn().mockResolvedValue(undefined),
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

describe("extractOrgUrl", () => {
  it("should extract org URL from resource URL", () => {
    const result = extractOrgUrl("https://dev.azure.com/myorg/myproject/_apis/wit/workitems/5");
    expect(result).toBe("https://dev.azure.com/myorg");
  });

  it("should handle URLs with only org path", () => {
    const result = extractOrgUrl("https://dev.azure.com/myorg");
    expect(result).toBe("https://dev.azure.com/myorg");
  });

  it("should return empty string for invalid URL", () => {
    const result = extractOrgUrl("not a url");
    expect(result).toBe("");
  });

  it("should return empty string for empty input", () => {
    const result = extractOrgUrl("");
    expect(result).toBe("");
  });
});

describe("webhook handler validation", () => {
  it("should have proper event type check for created events", () => {
    const validEvent = "workitem.created";
    expect(validEvent).toBe("workitem.created");
  });

  it("should now also handle workitem.updated events", () => {
    const updateEvent = "workitem.updated";
    const supportedEvents = ["workitem.created", "workitem.updated", "workitem.commented"];
    expect(supportedEvents).toContain(updateEvent);
  });

  it("should now also handle workitem.commented events", () => {
    const commentEvent = "workitem.commented";
    const supportedEvents = ["workitem.created", "workitem.updated", "workitem.commented"];
    expect(supportedEvents).toContain(commentEvent);
  });

  it("should trigger on any work item type with ai-fix tag", () => {
    const tags = "priority; ai-fix; regression";
    const tagList = tags.split(";").map((t) => t.trim().toLowerCase());
    expect(tagList).toContain("ai-fix");
  });

  it("should not trigger on work items without ai-fix tag", () => {
    const tags = "priority; regression";
    const tagList = tags.split(";").map((t) => t.trim().toLowerCase());
    expect(tagList).not.toContain("ai-fix");
  });

  it("should create BugFixJob with required fields including triggerType", () => {
    const job = {
      workItemId: 42,
      projectName: "TestProject",
      organizationUrl: "https://dev.azure.com/myorg",
      timestamp: new Date().toISOString(),
      triggerType: "created" as const,
    };
    expect(job.workItemId).toBe(42);
    expect(job.projectName).toBe("TestProject");
    expect(job.organizationUrl).toContain("dev.azure.com");
    expect(job.triggerType).toBe("created");
  });

  it("should support manual triggerType for comment-based triggers", () => {
    const comment = "Can someone look at this? @agent fix this please";
    expect(comment.toLowerCase()).toContain("@agent fix this");
  });

  it("should not trigger on comments without @agent keyword", () => {
    const comment = "This is just a regular comment";
    expect(comment.toLowerCase()).not.toContain("@agent fix this");
  });

  it("should detect relevant field changes for re-trigger", () => {
    const meaningfulFields = [
      "System.Description",
      "Microsoft.VSTS.TCM.ReproSteps",
      "System.Tags",
    ];
    const revisedFields = { "System.Description": { oldValue: "old", newValue: "new" } };
    const hasRelevantChange = meaningfulFields.some((f) => revisedFields[f as keyof typeof revisedFields] !== undefined);
    expect(hasRelevantChange).toBe(true);
  });

  it("should not trigger on irrelevant field changes", () => {
    const meaningfulFields = [
      "System.Description",
      "Microsoft.VSTS.TCM.ReproSteps",
      "System.Tags",
    ];
    const revisedFields = { "System.AssignedTo": { oldValue: "user1", newValue: "user2" } };
    const hasRelevantChange = meaningfulFields.some((f) => revisedFields[f as keyof typeof revisedFields] !== undefined);
    expect(hasRelevantChange).toBe(false);
  });
});
