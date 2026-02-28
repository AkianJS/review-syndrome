import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLogger } from "../src/shared/logger.js";

describe("createLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should log info messages with context prefix", () => {
    const logger = createLogger("Test");
    logger.info("hello world");

    expect(console.log).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(loggedJson.level).toBe("info");
    expect(loggedJson.message).toContain("[Test]");
    expect(loggedJson.message).toContain("hello world");
  });

  it("should log warn messages", () => {
    const logger = createLogger("Test");
    logger.warn("be careful");

    expect(console.warn).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse((console.warn as any).mock.calls[0][0]);
    expect(loggedJson.level).toBe("warn");
    expect(loggedJson.message).toContain("be careful");
  });

  it("should log error messages with error details", () => {
    const logger = createLogger("Test");
    const err = new Error("something broke");
    logger.error("failed", err);

    expect(console.error).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse((console.error as any).mock.calls[0][0]);
    expect(loggedJson.level).toBe("error");
    expect(loggedJson.error).toBe("something broke");
    expect(loggedJson.stack).toBeDefined();
  });

  it("should include custom properties in log output", () => {
    const logger = createLogger("Test");
    logger.info("processing", { workItemId: 42, projectName: "MyProject", step: "clone" });

    const loggedJson = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(loggedJson.workItemId).toBe(42);
    expect(loggedJson.projectName).toBe("MyProject");
    expect(loggedJson.step).toBe("clone");
  });

  it("should track metrics", () => {
    const logger = createLogger("Test");
    logger.trackMetric("cost_usd", 0.42, { workItemId: 1 });

    expect(console.log).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(loggedJson.level).toBe("metric");
    expect(loggedJson.name).toBe("cost_usd");
    expect(loggedJson.value).toBe(0.42);
  });

  it("should track events", () => {
    const logger = createLogger("Test");
    logger.trackEvent("pr_created", { workItemId: 1, prId: 99 });

    expect(console.log).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(loggedJson.level).toBe("event");
    expect(loggedJson.name).toBe("pr_created");
  });

  it("should work without context prefix", () => {
    const logger = createLogger();
    logger.info("no prefix");

    const loggedJson = JSON.parse((console.log as any).mock.calls[0][0]);
    expect(loggedJson.message).toBe(" no prefix");
  });
});
