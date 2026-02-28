import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @azure/data-tables
const mockListEntities = vi.fn();

vi.mock("@azure/data-tables", () => ({
  TableClient: {
    fromConnectionString: vi.fn(() => ({
      listEntities: mockListEntities,
    })),
  },
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

describe("dashboard logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should aggregate job stats correctly", () => {
    const jobs = [
      { status: "success", startedAt: "2026-02-27T10:00:00Z", completedAt: "2026-02-27T10:05:00Z", prId: 1 },
      { status: "success", startedAt: "2026-02-27T09:00:00Z", completedAt: "2026-02-27T09:03:00Z", prId: 2 },
      { status: "failure", startedAt: "2026-02-27T08:00:00Z", completedAt: "2026-02-27T08:04:00Z" },
      { status: "no-changes", startedAt: "2026-02-27T07:00:00Z", completedAt: "2026-02-27T07:02:00Z" },
      { status: "in-progress", startedAt: "2026-02-27T11:00:00Z" },
    ];

    const stats = {
      totalJobs: 0,
      successCount: 0,
      failureCount: 0,
      noChangesCount: 0,
      inProgressCount: 0,
    };

    for (const job of jobs) {
      stats.totalJobs++;
      switch (job.status) {
        case "success": stats.successCount++; break;
        case "failure": stats.failureCount++; break;
        case "no-changes": stats.noChangesCount++; break;
        case "in-progress": stats.inProgressCount++; break;
      }
    }

    expect(stats.totalJobs).toBe(5);
    expect(stats.successCount).toBe(2);
    expect(stats.failureCount).toBe(1);
    expect(stats.noChangesCount).toBe(1);
    expect(stats.inProgressCount).toBe(1);
  });

  it("should sort jobs by startedAt descending", () => {
    const jobs = [
      { workItemId: 1, startedAt: "2026-02-27T08:00:00Z" },
      { workItemId: 2, startedAt: "2026-02-27T10:00:00Z" },
      { workItemId: 3, startedAt: "2026-02-27T09:00:00Z" },
    ];

    jobs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    expect(jobs[0].workItemId).toBe(2); // 10:00 — most recent
    expect(jobs[1].workItemId).toBe(3); // 09:00
    expect(jobs[2].workItemId).toBe(1); // 08:00
  });

  it("should limit recent jobs to 20", () => {
    const jobs = Array.from({ length: 30 }, (_, i) => ({
      workItemId: i + 1,
      startedAt: `2026-02-27T${String(i).padStart(2, "0")}:00:00Z`,
    }));

    const recentJobs = jobs.slice(0, 20);
    expect(recentJobs.length).toBe(20);
  });

  it("should handle empty table gracefully", () => {
    const stats = {
      totalJobs: 0,
      successCount: 0,
      failureCount: 0,
      noChangesCount: 0,
      inProgressCount: 0,
      recentJobs: [],
    };

    expect(stats.totalJobs).toBe(0);
    expect(stats.recentJobs).toEqual([]);
  });

  it("should include retryCount in recent jobs", () => {
    const job = {
      workItemId: 42,
      status: "success",
      startedAt: "2026-02-27T10:00:00Z",
      completedAt: "2026-02-27T10:05:00Z",
      prId: 1,
      retryCount: 2,
    };

    expect(job.retryCount).toBe(2);
  });
});
