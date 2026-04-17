import { describe, it, expect } from "vitest";
import { generateToken, isValidTokenFormat, tokensEqual } from "../../src/lib/tokens.js";

describe("tokens", () => {
  describe("generateToken", () => {
    it("returns a 43-char URL-safe base64 token", () => {
      const t = generateToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(t.length).toBe(43);
    });

    it("produces unique tokens on repeated calls", () => {
      const set = new Set<string>();
      for (let i = 0; i < 100; i++) set.add(generateToken());
      expect(set.size).toBe(100);
    });
  });

  describe("isValidTokenFormat", () => {
    it("validates a freshly generated token", () => {
      expect(isValidTokenFormat(generateToken())).toBe(true);
    });

    it("rejects strings that are too short", () => {
      expect(isValidTokenFormat("abc")).toBe(false);
    });

    it("rejects strings with unsafe characters", () => {
      expect(isValidTokenFormat("a".repeat(42) + "!")).toBe(false);
      expect(isValidTokenFormat("a".repeat(42) + "=")).toBe(false);
      expect(isValidTokenFormat("a".repeat(42) + "/")).toBe(false);
    });

    it("rejects non-string inputs", () => {
      // @ts-expect-error deliberate wrong type
      expect(isValidTokenFormat(null)).toBe(false);
      // @ts-expect-error deliberate wrong type
      expect(isValidTokenFormat(undefined)).toBe(false);
      // @ts-expect-error deliberate wrong type
      expect(isValidTokenFormat(12345)).toBe(false);
    });
  });

  describe("tokensEqual", () => {
    it("returns true for identical valid tokens", () => {
      const t = generateToken();
      expect(tokensEqual(t, t)).toBe(true);
    });

    it("returns false for different valid tokens", () => {
      expect(tokensEqual(generateToken(), generateToken())).toBe(false);
    });

    it("returns false for malformed inputs without crashing", () => {
      expect(tokensEqual("short", "short")).toBe(false);
      expect(tokensEqual(generateToken(), "not-a-token")).toBe(false);
      expect(tokensEqual("", "")).toBe(false);
    });
  });
});
