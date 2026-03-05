import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  stripHtml,
  buildAuthHeader,
  extractImagesFromHtml,
  extractAttachmentUrls,
  downloadWorkItemImages,
} from "../src/shared/azure-devops-client.js";
import type { ImageAttachment } from "../src/shared/types.js";

describe("buildAuthHeader", () => {
  it("should return a Basic auth header with base64-encoded PAT", () => {
    const header = buildAuthHeader("my-pat-token");
    const expected = `Basic ${Buffer.from(":my-pat-token").toString("base64")}`;
    expect(header).toBe(expected);
  });

  it("should handle empty PAT", () => {
    const header = buildAuthHeader("");
    const expected = `Basic ${Buffer.from(":").toString("base64")}`;
    expect(header).toBe(expected);
  });
});

describe("stripHtml", () => {
  it("should remove HTML tags", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("should convert <br> to newlines", () => {
    expect(stripHtml("Line 1<br>Line 2<br/>Line 3")).toBe(
      "Line 1\nLine 2\nLine 3"
    );
  });

  it("should convert block elements to newlines", () => {
    const result = stripHtml("<div>Block 1</div><div>Block 2</div>");
    expect(result).toContain("Block 1");
    expect(result).toContain("Block 2");
  });

  it("should decode HTML entities", () => {
    // Trailing &nbsp; becomes a space that gets trimmed
    expect(stripHtml("&amp; &lt; &gt; &quot; &#39;")).toBe('& < > " \'');
    expect(stripHtml("hello&nbsp;world")).toBe("hello world");
  });

  it("should handle empty string", () => {
    expect(stripHtml("")).toBe("");
  });

  it("should handle null/undefined gracefully", () => {
    expect(stripHtml(null as unknown as string)).toBe("");
    expect(stripHtml(undefined as unknown as string)).toBe("");
  });

  it("should collapse multiple newlines", () => {
    const result = stripHtml("<p>A</p><p></p><p></p><p>B</p>");
    const lines = result.split("\n").filter((l) => l.trim());
    expect(lines).toContain("A");
    expect(lines).toContain("B");
  });
});

describe("extractImagesFromHtml", () => {
  it("should extract image URLs from HTML with img tags", () => {
    const html = `<p>See the error:</p><img src="https://dev.azure.com/org/project/_apis/wit/attachments/guid?fileName=error.png" />`;
    const result = extractImagesFromHtml(html);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://dev.azure.com/org/project/_apis/wit/attachments/guid?fileName=error.png");
    expect(result[0].filename).toBe("error.png");
    expect(result[0].source).toBe("inline");
  });

  it("should return empty array when no images", () => {
    const html = `<p>Just some text <b>bold</b></p>`;
    expect(extractImagesFromHtml(html)).toEqual([]);
  });

  it("should extract multiple images in order", () => {
    const html = `
      <img src="https://example.com/a.png" />
      <img src="https://example.com/b.jpg" />
      <img src="https://example.com/c.gif" />
    `;
    const result = extractImagesFromHtml(html);
    expect(result).toHaveLength(3);
    expect(result[0].filename).toBe("a.png");
    expect(result[1].filename).toBe("b.jpg");
    expect(result[2].filename).toBe("c.gif");
  });

  it("should filter out non-image src URLs", () => {
    const html = `<img src="https://example.com/file.pdf" /><img src="https://example.com/ok.png" />`;
    const result = extractImagesFromHtml(html);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("ok.png");
  });

  it("should deduplicate by URL", () => {
    const html = `
      <img src="https://example.com/same.png" />
      <img src="https://example.com/same.png" />
    `;
    const result = extractImagesFromHtml(html);
    expect(result).toHaveLength(1);
  });

  it("should handle empty or falsy input", () => {
    expect(extractImagesFromHtml("")).toEqual([]);
    expect(extractImagesFromHtml(null as unknown as string)).toEqual([]);
    expect(extractImagesFromHtml(undefined as unknown as string)).toEqual([]);
  });

  it("should derive filename from last path segment when no fileName param", () => {
    const html = `<img src="https://example.com/images/screenshot.jpg" />`;
    const result = extractImagesFromHtml(html);
    expect(result[0].filename).toBe("screenshot.jpg");
  });
});

describe("extractAttachmentUrls", () => {
  it("should extract image attachments from relations", () => {
    const relations = [
      {
        rel: "AttachedFile",
        url: "https://dev.azure.com/org/_apis/wit/attachments/guid1",
        attributes: { name: "screenshot.png" },
      },
    ];
    const result = extractAttachmentUrls(relations);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://dev.azure.com/org/_apis/wit/attachments/guid1");
    expect(result[0].filename).toBe("screenshot.png");
    expect(result[0].source).toBe("attachment");
  });

  it("should filter out non-image attachments", () => {
    const relations = [
      {
        rel: "AttachedFile",
        url: "https://example.com/att1",
        attributes: { name: "log.txt" },
      },
      {
        rel: "AttachedFile",
        url: "https://example.com/att2",
        attributes: { name: "error.png" },
      },
    ];
    const result = extractAttachmentUrls(relations);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("error.png");
  });

  it("should ignore non-AttachedFile relations", () => {
    const relations = [
      {
        rel: "ArtifactLink",
        url: "https://example.com/att1",
        attributes: { name: "image.png" },
      },
    ];
    expect(extractAttachmentUrls(relations)).toEqual([]);
  });

  it("should return empty for undefined relations", () => {
    expect(extractAttachmentUrls(undefined)).toEqual([]);
  });

  it("should return empty for empty array", () => {
    expect(extractAttachmentUrls([])).toEqual([]);
  });
});

const { mockMkdir, mockWriteFile } = vi.hoisted(() => ({
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: any[]) => mockMkdir(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
}));

describe("downloadWorkItemImages", () => {
  beforeEach(() => {
    mockMkdir.mockClear();
    mockWriteFile.mockClear();
  });

  function mockFetchResponse(options: {
    ok?: boolean;
    status?: number;
    contentType?: string;
    contentLength?: string;
    body?: ArrayBuffer;
  }) {
    const {
      ok = true,
      status = 200,
      contentType = "image/png",
      contentLength = "1024",
      body = new ArrayBuffer(1024),
    } = options;

    return vi.fn().mockResolvedValue({
      ok,
      status,
      headers: new Map([
        ["content-type", contentType],
        ["content-length", contentLength],
      ]) as unknown as Headers,
      arrayBuffer: vi.fn().mockResolvedValue(body),
    });
  }

  it("should download images successfully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchResponse({ contentType: "image/png", contentLength: "1024" });

    const images: ImageAttachment[] = [
      { url: "https://example.com/img.png", filename: "img.png", source: "inline" },
    ];
    const result = await downloadWorkItemImages(images, "/tmp/work", "test-pat");

    expect(result).toHaveLength(1);
    expect(result[0].localPath).toContain("inline-0-img.png");
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();

    globalThis.fetch = originalFetch;
  });

  it("should skip images with non-image content-type", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchResponse({ contentType: "text/html", contentLength: "1024" });

    const images: ImageAttachment[] = [
      { url: "https://example.com/img.png", filename: "img.png", source: "inline" },
    ];
    const result = await downloadWorkItemImages(images, "/tmp/work", "test-pat");

    expect(result).toHaveLength(0);
    globalThis.fetch = originalFetch;
  });

  it("should skip images exceeding 20MB", async () => {
    const originalFetch = globalThis.fetch;
    const bigSize = String(21 * 1024 * 1024);
    globalThis.fetch = mockFetchResponse({ contentType: "image/png", contentLength: bigSize });

    const images: ImageAttachment[] = [
      { url: "https://example.com/big.png", filename: "big.png", source: "inline" },
    ];
    const result = await downloadWorkItemImages(images, "/tmp/work", "test-pat");

    expect(result).toHaveLength(0);
    globalThis.fetch = originalFetch;
  });

  it("should handle individual download failures gracefully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const images: ImageAttachment[] = [
      { url: "https://example.com/img.png", filename: "img.png", source: "inline" },
    ];
    const result = await downloadWorkItemImages(images, "/tmp/work", "test-pat");

    expect(result).toHaveLength(0);
    globalThis.fetch = originalFetch;
  });

  it("should return empty array for empty input", async () => {
    const result = await downloadWorkItemImages([], "/tmp/work", "test-pat");
    expect(result).toEqual([]);
  });
});
