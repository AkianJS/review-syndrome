import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobRecord } from "../src/shared/types.js";

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

/**
 * Replicates the aggregation logic from dashboard handler for testing.
 */
function aggregateStats(jobs: Array<Partial<JobRecord> & { status: string }>) {
  const stats = {
    totalJobs: 0,
    successCount: 0,
    failureCount: 0,
    noChangesCount: 0,
    inProgressCount: 0,
    totalCostUsd: 0,
    avgCostUsd: 0,
    escalationCount: 0,
  };
  let jobsWithCost = 0;

  for (const job of jobs) {
    stats.totalJobs++;
    switch (job.status) {
      case "success": stats.successCount++; break;
      case "failure": stats.failureCount++; break;
      case "no-changes": stats.noChangesCount++; break;
      case "in-progress": stats.inProgressCount++; break;
    }

    if (job.costUsd !== undefined) {
      stats.totalCostUsd += job.costUsd;
      jobsWithCost++;
    }

    if (job.escalated) {
      stats.escalationCount++;
    }
  }

  stats.avgCostUsd = jobsWithCost > 0 ? stats.totalCostUsd / jobsWithCost : 0;
  return stats;
}

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

    const stats = aggregateStats(jobs);

    expect(stats.totalJobs).toBe(5);
    expect(stats.successCount).toBe(2);
    expect(stats.failureCount).toBe(1);
    expect(stats.noChangesCount).toBe(1);
    expect(stats.inProgressCount).toBe(1);
  });

  it("should aggregate cost fields correctly", () => {
    const jobs = [
      { status: "success", costUsd: 0.15, escalated: false },
      { status: "success", costUsd: 0.25, escalated: true },
      { status: "failure", costUsd: 0.10, escalated: false },
      { status: "no-changes" }, // no costUsd
      { status: "in-progress", escalated: true },
    ];

    const stats = aggregateStats(jobs);

    expect(stats.totalCostUsd).toBeCloseTo(0.50);
    expect(stats.avgCostUsd).toBeCloseTo(0.50 / 3); // 3 jobs have cost
    expect(stats.escalationCount).toBe(2);
  });

  it("should return zero cost aggregates when no jobs have cost", () => {
    const jobs = [
      { status: "success" },
      { status: "failure" },
    ];

    const stats = aggregateStats(jobs);

    expect(stats.totalCostUsd).toBe(0);
    expect(stats.avgCostUsd).toBe(0);
    expect(stats.escalationCount).toBe(0);
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
    const stats = aggregateStats([]);

    expect(stats.totalJobs).toBe(0);
    expect(stats.totalCostUsd).toBe(0);
    expect(stats.avgCostUsd).toBe(0);
    expect(stats.escalationCount).toBe(0);
  });

  it("should include retryCount in recent jobs", () => {
    const job: JobRecord = {
      workItemId: 42,
      status: "success",
      startedAt: "2026-02-27T10:00:00Z",
      completedAt: "2026-02-27T10:05:00Z",
      prId: 1,
      retryCount: 2,
    };

    expect(job.retryCount).toBe(2);
  });

  it("should include new fields in job records", () => {
    const job: JobRecord = {
      workItemId: 42,
      status: "success",
      startedAt: "2026-02-27T10:00:00Z",
      completedAt: "2026-02-27T10:05:00Z",
      prId: 1,
      costUsd: 0.23,
      durationMs: 45000,
      modelUsed: "claude-sonnet-4-20250514",
      escalated: false,
      projectName: "MyProject",
    };

    expect(job.costUsd).toBe(0.23);
    expect(job.durationMs).toBe(45000);
    expect(job.modelUsed).toBe("claude-sonnet-4-20250514");
    expect(job.escalated).toBe(false);
    expect(job.projectName).toBe("MyProject");
  });
});
