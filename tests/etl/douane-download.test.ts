import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DouaneDownloadError, downloadToFile } from "../../etl/douane/download.js";

const zipResponse = (body = "contenu", headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "binary/octet-stream", "content-length": String(body.length), etag: '"e"', "last-modified": "Tue, 20 Oct 2026 06:08:55 GMT", ...headers } });
const networkError = () => Object.assign(new TypeError("fetch failed TEMOIN"), { cause: { code: "ECONNRESET" } });

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "osd-douane-test-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function run(fetchImpl: unknown, maxBytes = 100) {
  const sleep = vi.fn(async () => undefined);
  const log = vi.fn();
  const path = join(dir, "f.zip");
  const result = downloadToFile({ url: "https://exemple.invalid/f.zip", path, userAgent: "test", maxBytes, fetchImpl: fetchImpl as typeof fetch, sleep, log });
  return { result, sleep, log, path };
}

describe("téléchargement des fichiers de l'OFDF", () => {
  it("écrit sur le disque et rend empreinte, taille et date de la source", async () => {
    const { result, path } = run(vi.fn(async () => zipResponse()));
    const file = await result;
    expect(readFileSync(path, "utf8")).toBe("contenu");
    expect(file.bytes).toBe(7);
    expect(file.sha256).toBe(createHash("sha256").update("contenu").digest("hex"));
    expect(file.lastModified).toBe("Tue, 20 Oct 2026 06:08:55 GMT");
  });
  it("reprend après une panne réseau et un 503", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(zipResponse());
    const { result, sleep, log } = run(fetchImpl);
    await result;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toContain("TypeError ECONNRESET");
    expect(log.mock.calls[0][0]).not.toContain("TEMOIN");
  });
  it("un fichier tronqué se reprend, puis arrête", async () => {
    const truncated = () => zipResponse("court", { "content-length": "50" });
    const { result } = run(vi.fn(async () => truncated()));
    await expect(result).rejects.toThrow("Source OFDF : échec après 3 essais (fichier tronqué)");
  });
  it.each([
    ["404", () => new Response("", { status: 404 })],
    ["page d'erreur", () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["taille annoncée", () => zipResponse("x".repeat(200))],
    ["taille réelle sans annonce", () => new Response("x".repeat(200), { status: 200, headers: { "content-type": "binary/octet-stream" } })],
  ])("%s : pas de reprise", async (_label, response) => {
    const fetchImpl = vi.fn(async () => response());
    const { result } = run(fetchImpl);
    await expect(result).rejects.toBeInstanceOf(DouaneDownloadError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
