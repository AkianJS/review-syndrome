import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @azure/data-tables before importing
const mockGetEntity = vi.fn();
const mockCreateEntity = vi.fn();
const mockUpdateEntity = vi.fn();
const mockDeleteEntity = vi.fn();
const mockCreateTable = vi.fn();

vi.mock("@azure/data-tables", () => ({
  TableClient: {
    fromConnectionString: vi.fn(() => ({
      getEntity: mockGetEntity,
      createEntity: mockCreateEntity,
      updateEntity: mockUpdateEntity,
      deleteEntity: mockDeleteEntity,
      createTable: mockCreateTable,
    })),
  },
  RestError: class RestError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import {
  isJobProcessed,
  markJobStarted,
  markJobCompleted,
  ensureTable,
  resetJob,
  getJobRecord,
  incrementRetryCount,
} from "../src/shared/job-tracker.js";

describe("job-tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["AzureWebJobsStorage"] = "UseDevelopmentStorage=true";
  });

  describe("isJobProcessed", () => {
    it("should return true when job status is success", async () => {
      mockGetEntity.mockResolvedValue({ status: "success" });
      expect(await isJobProcessed(42)).toBe(true);
    });

    it("should return true when job status is in-progress", async () => {
      mockGetEntity.mockResolvedValue({ status: "in-progress" });
      expect(await isJobProcessed(42)).toBe(true);
    });

    it("should return false when entity not found (404)", async () => {
      mockGetEntity.mockRejectedValue({ statusCode: 404 });
      expect(await isJobProcessed(42)).toBe(false);
    });

    it("should return false when job status is failure", async () => {
      mockGetEntity.mockResolvedValue({ status: "failure" });
      expect(await isJobProcessed(42)).toBe(false);
    });

    it("should throw on unexpected errors", async () => {
      mockGetEntity.mockRejectedValue({ statusCode: 500, message: "server error" });
      await expect(isJobProcessed(42)).rejects.toEqual({ statusCode: 500, message: "server error" });
    });
  });

  describe("markJobStarted", () => {
    it("should return true when entity is created successfully", async () => {
      mockCreateEntity.mockResolvedValue({});
      expect(await markJobStarted(42)).toBe(true);
      expect(mockCreateEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          partitionKey: "jobs",
          rowKey: "42",
          status: "in-progress",
        })
      );
    });

    it("should return false when entity already exists (409)", async () => {
      mockCreateEntity.mockRejectedValue({ statusCode: 409 });
      expect(await markJobStarted(42)).toBe(false);
    });

    it("should throw on unexpected errors", async () => {
      mockCreateEntity.mockRejectedValue({ statusCode: 500 });
      await expect(markJobStarted(42)).rejects.toEqual({ statusCode: 500 });
    });
  });

  describe("markJobCompleted", () => {
    it("should update entity with success status", async () => {
      mockUpdateEntity.mockResolvedValue({});
      await markJobCompleted(42, "success", 123);
      expect(mockUpdateEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          partitionKey: "jobs",
          rowKey: "42",
          status: "success",
          prId: 123,
        }),
        "Merge"
      );
    });

    it("should update entity without prId for failure", async () => {
      mockUpdateEntity.mockResolvedValue({});
      await markJobCompleted(42, "failure");
      expect(mockUpdateEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failure",
        }),
        "Merge"
      );
    });
  });

  describe("ensureTable", () => {
    it("should call createTable", async () => {
      mockCreateTable.mockResolvedValue({});
      await ensureTable();
      expect(mockCreateTable).toHaveBeenCalled();
    });
  });

  describe("resetJob", () => {
    it("should delete entity for the work item", async () => {
      mockDeleteEntity.mockResolvedValue({});
      await resetJob(42);
      expect(mockDeleteEntity).toHaveBeenCalledWith("jobs", "42");
    });

    it("should not throw when entity does not exist (404)", async () => {
      mockDeleteEntity.mockRejectedValue({ statusCode: 404 });
      await expect(resetJob(42)).resolves.not.toThrow();
    });

    it("should throw on unexpected errors", async () => {
      mockDeleteEntity.mockRejectedValue({ statusCode: 500 });
      await expect(resetJob(42)).rejects.toEqual({ statusCode: 500 });
    });
  });

  describe("getJobRecord", () => {
    it("should return job record when found", async () => {
      mockGetEntity.mockResolvedValue({
        status: "success",
        startedAt: "2026-02-27T10:00:00Z",
        completedAt: "2026-02-27T10:05:00Z",
        prId: 123,
        retryCount: 1,
      });

      const record = await getJobRecord(42);
      expect(record).toEqual({
        workItemId: 42,
        status: "success",
        startedAt: "2026-02-27T10:00:00Z",
        completedAt: "2026-02-27T10:05:00Z",
        prId: 123,
        retryCount: 1,
      });
    });

    it("should return undefined when not found (404)", async () => {
      mockGetEntity.mockRejectedValue({ statusCode: 404 });
      const record = await getJobRecord(42);
      expect(record).toBeUndefined();
    });
  });

  describe("incrementRetryCount", () => {
    it("should increment from 0 to 1 when no previous retries", async () => {
      mockGetEntity.mockRejectedValue({ statusCode: 404 }); // getJobRecord returns undefined
      mockUpdateEntity.mockResolvedValue({});

      const count = await incrementRetryCount(42);
      expect(count).toBe(1);
      expect(mockUpdateEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          partitionKey: "jobs",
          rowKey: "42",
          retryCount: 1,
        }),
        "Merge"
      );
    });

    it("should increment existing retry count", async () => {
      mockGetEntity.mockResolvedValue({
        status: "success",
        startedAt: "2026-02-27T10:00:00Z",
        retryCount: 1,
      });
      mockUpdateEntity.mockResolvedValue({});

      const count = await incrementRetryCount(42);
      expect(count).toBe(2);
    });
  });
});
