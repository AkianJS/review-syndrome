import { describe, it, expect, vi, beforeEach } from "vitest";
import { stripHtml, buildAuthHeader } from "../src/shared/azure-devops-client.js";

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
