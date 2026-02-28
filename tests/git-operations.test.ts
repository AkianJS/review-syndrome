import { describe, it, expect } from "vitest";
import { sanitizeBranchName } from "../src/shared/git-operations.js";

describe("sanitizeBranchName", () => {
  it("should create a valid branch name from work item ID and title", () => {
    const result = sanitizeBranchName(1234, "Login Button Crash");
    expect(result).toBe("bugfix/wi-1234-login-button-crash");
  });

  it("should handle special characters", () => {
    const result = sanitizeBranchName(5678, "Null ref in payment (prod)");
    expect(result).toBe("bugfix/wi-5678-null-ref-in-payment-prod");
  });

  it("should truncate long titles to 50 characters", () => {
    const longTitle =
      "This is a very long bug title that should be truncated because it exceeds the maximum length";
    const result = sanitizeBranchName(42, longTitle);
    const slug = result.replace("bugfix/wi-42-", "");
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("should not end with a hyphen after truncation", () => {
    const title = "Some title that ends at a bad-spot for truncation x";
    const result = sanitizeBranchName(1, title);
    expect(result).not.toMatch(/-$/);
  });

  it("should handle titles with only special characters", () => {
    const result = sanitizeBranchName(99, "!@#$%^&*()");
    expect(result).toBe("bugfix/wi-99-");
  });

  it("should lowercase everything", () => {
    const result = sanitizeBranchName(1, "FIX THE BIG BUG");
    expect(result).toBe("bugfix/wi-1-fix-the-big-bug");
  });
});
