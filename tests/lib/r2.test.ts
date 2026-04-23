import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted so mock variables are available when vi.mock factories run
const { sendMock, getSignedUrlMock } = vi.hoisted(() => {
  const sendMock = vi.fn().mockResolvedValue({});
  const getSignedUrlMock = vi
    .fn()
    .mockResolvedValue(
      "https://example.r2.cloudflarestorage.com/signed?X-Amz=..."
    );
  return { sendMock, getSignedUrlMock };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: vi
    .fn()
    .mockImplementation((input) => ({ __type: "PutObjectCommand", input })),
  GetObjectCommand: vi
    .fn()
    .mockImplementation((input) => ({ __type: "GetObjectCommand", input })),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

import { uploadZip, signedDownloadUrl } from "../../src/lib/r2.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("lib/r2", () => {
  let tmp: string;
  let localPath: string;

  beforeEach(() => {
    sendMock.mockClear();
    getSignedUrlMock.mockClear();
    process.env.R2_ACCOUNT_ID = "abc123";
    process.env.R2_ACCESS_KEY_ID = "aki";
    process.env.R2_SECRET_ACCESS_KEY = "sak";
    process.env.R2_BUCKET = "openswissdata-test";
    tmp = mkdtempSync(join(tmpdir(), "osd-r2-"));
    localPath = join(tmp, "x.zip");
    writeFileSync(
      localPath,
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]) // minimal ZIP magic
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    for (const k of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
    ]) {
      delete process.env[k];
    }
  });

  describe("uploadZip", () => {
    it("calls S3 PutObject with correct bucket, key, content-type", async () => {
      await uploadZip(localPath, "tares/2026.04.22.zip");
      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.__type).toBe("PutObjectCommand");
      expect(cmd.input.Bucket).toBe("openswissdata-test");
      expect(cmd.input.Key).toBe("tares/2026.04.22.zip");
      expect(cmd.input.ContentType).toBe("application/zip");
      expect(Buffer.isBuffer(cmd.input.Body)).toBe(true);
    });

    it("throws when R2 credentials are missing", async () => {
      delete process.env.R2_ACCESS_KEY_ID;
      await expect(uploadZip(localPath, "k")).rejects.toThrow(
        /R2 credentials missing/
      );
    });

    it("throws when R2_BUCKET is missing", async () => {
      delete process.env.R2_BUCKET;
      await expect(uploadZip(localPath, "k")).rejects.toThrow(/R2_BUCKET/);
    });
  });

  describe("signedDownloadUrl", () => {
    it("generates a signed URL for a GetObject with default 300s expiry", async () => {
      const url = await signedDownloadUrl("tares/2026.04.22.zip");
      expect(url).toMatch(/^https:\/\//);
      expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
      const [, cmd, opts] = getSignedUrlMock.mock.calls[0];
      expect(cmd.__type).toBe("GetObjectCommand");
      expect(cmd.input.Bucket).toBe("openswissdata-test");
      expect(cmd.input.Key).toBe("tares/2026.04.22.zip");
      expect(opts.expiresIn).toBe(300);
    });

    it("honors custom expiresSeconds", async () => {
      await signedDownloadUrl("some/key", 60);
      const [, , opts] = getSignedUrlMock.mock.calls[0];
      expect(opts.expiresIn).toBe(60);
    });

    it("throws when R2 credentials are missing", async () => {
      delete process.env.R2_SECRET_ACCESS_KEY;
      await expect(signedDownloadUrl("k")).rejects.toThrow(
        /R2 credentials missing/
      );
    });

    // commit 8eaf942 — force named ZIP download via Content-Disposition
    it("passes ResponseContentDisposition with filename derived from key last segment", async () => {
      await signedDownloadUrl("tares/2026.04.22/tares.zip");
      const [, cmd] = getSignedUrlMock.mock.calls[0];
      expect(cmd.__type).toBe("GetObjectCommand");
      expect(cmd.input.ResponseContentDisposition).toBe('attachment; filename="tares.zip"');
    });

    it("uses the bare filename when key has no path separator", async () => {
      await signedDownloadUrl("tares.zip");
      const [, cmd] = getSignedUrlMock.mock.calls[0];
      expect(cmd.input.ResponseContentDisposition).toBe('attachment; filename="tares.zip"');
    });

    it("uses the last non-empty segment even when key ends with a slash", async () => {
      // filter(Boolean) removes trailing empty strings, so "tares/2026.04.22/" → pop() = "2026.04.22"
      await signedDownloadUrl("tares/2026.04.22/");
      const [, cmd] = getSignedUrlMock.mock.calls[0];
      expect(cmd.input.ResponseContentDisposition).toBe('attachment; filename="2026.04.22"');
    });
  });
});
