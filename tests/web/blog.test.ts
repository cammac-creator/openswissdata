import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("blog content", () => {
  const blogDir = join(process.cwd(), "web/src/content/blog");

  it("has at least 3 published articles", () => {
    const entries = ["integrate-tares-sap-gts.md", "swiss-classifications-multi-standard.md", "finma-registry-compliance.md"];
    for (const e of entries) {
      expect(existsSync(join(blogDir, e)), `missing ${e}`).toBe(true);
    }
  });

  it("each article has required frontmatter + length > 1500 words", () => {
    const entries = ["integrate-tares-sap-gts.md", "swiss-classifications-multi-standard.md", "finma-registry-compliance.md"];
    for (const e of entries) {
      const content = readFileSync(join(blogDir, e), "utf8");
      expect(content, `${e} missing title frontmatter`).toMatch(/^title:/m);
      expect(content, `${e} missing description frontmatter`).toMatch(/^description:/m);
      expect(content, `${e} missing publishedAt frontmatter`).toMatch(/^publishedAt:/m);
      // Word count guard: > 1500 words (rough proxy — count whitespace-separated tokens in the body only)
      const body = content.split("---").slice(2).join("---"); // strip frontmatter
      const words = body.trim().split(/\s+/).length;
      expect(words, `${e} only ${words} words (need > 1500)`).toBeGreaterThan(1500);
    }
  });
});
