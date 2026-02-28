import { describe, it, expect } from "vitest";
import { buildAgentPrompt } from "../src/shared/prompt-builder.js";
import { WorkItemDetails } from "../src/shared/types.js";

describe("buildAgentPrompt", () => {
  const baseWorkItem: WorkItemDetails = {
    id: 42,
    title: "Login button crashes on click",
    description: "The login button throws an error when clicked.",
    reproSteps: "1. Open the app\n2. Click login\n3. See crash",
    severity: "2 - High",
    priority: "1",
    systemInfo: "Windows 11, Chrome 120",
    comments: ["Seems related to auth module", "Confirmed in production"],
    projectName: "MyProject",
    organizationUrl: "https://dev.azure.com/myorg",
  };

  it("should include bug ID and title", () => {
    const prompt = buildAgentPrompt(baseWorkItem);
    expect(prompt).toContain("#42");
    expect(prompt).toContain("Login button crashes on click");
  });

  it("should include severity and priority", () => {
    const prompt = buildAgentPrompt(baseWorkItem);
    expect(prompt).toContain("2 - High");
    expect(prompt).toContain("**Priority**: 1");
  });

  it("should include description and repro steps", () => {
    const prompt = buildAgentPrompt(baseWorkItem);
    expect(prompt).toContain("The login button throws an error");
    expect(prompt).toContain("1. Open the app");
  });

  it("should include comments", () => {
    const prompt = buildAgentPrompt(baseWorkItem);
    expect(prompt).toContain("Seems related to auth module");
    expect(prompt).toContain("Confirmed in production");
  });

  it('should show "None" when there are no comments', () => {
    const workItem = { ...baseWorkItem, comments: [] };
    const prompt = buildAgentPrompt(workItem);
    expect(prompt).toContain("None");
  });

  it('should show "Not provided" for missing optional fields', () => {
    const workItem = {
      ...baseWorkItem,
      description: "",
      reproSteps: "",
      systemInfo: "",
    };
    const prompt = buildAgentPrompt(workItem);
    expect(prompt).toContain("Not provided");
  });

  it("should include agent instructions and constraints", () => {
    const prompt = buildAgentPrompt(baseWorkItem);
    expect(prompt).toContain("## Instructions");
    expect(prompt).toContain("## Constraints");
    expect(prompt).toContain("Do NOT refactor unrelated code");
    expect(prompt).toContain("Keep changes as small as possible");
  });
});
