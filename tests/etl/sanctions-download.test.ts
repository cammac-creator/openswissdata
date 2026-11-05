import { describe, expect, it, vi } from "vitest";
import { downloadWithRetries, safeErrorCode, SesamDownloadError } from "../../etl/sanctions/download.js";

const xmlResponse = (body = "<x/>") => new Response(body, { status: 200, headers: { "content-type": "text/xml" } });
const networkError = () => Object.assign(new TypeError("fetch failed TEMOIN"), { cause: { code: "ECONNRESET" } });

function run(fetchImpl: unknown, maxBytes = 100) {
  const sleep = vi.fn(async () => undefined);
  const log = vi.fn();
  const result = downloadWithRetries({ url: "https://exemple.invalid/x.xml", userAgent: "test", maxBytes, fetchImpl: fetchImpl as typeof fetch, sleep, log });
  return { result, sleep, log };
}

describe("téléchargement du fichier SESAM", () => {
  it("réussit du premier coup, sans attendre", async () => {
    const { result, sleep } = run(vi.fn(async () => xmlResponse()));
    expect((await result).toString()).toBe("<x/>");
    expect(sleep).not.toHaveBeenCalled();
  });
  it("reprend après une panne réseau, en attendant 30 s puis 2 min", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(xmlResponse());
    const { result, sleep, log } = run(fetchImpl);
    expect((await result).toString()).toBe("<x/>");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([30_000, 120_000]);
    expect(log.mock.calls[0][0]).toContain("TypeError ECONNRESET");
    expect(log.mock.calls[0][0]).not.toContain("TEMOIN");
  });
  it("trois échecs : erreur connue, avec le dernier code, sans contenu", async () => {
    const { result } = run(vi.fn(async () => { throw networkError(); }));
    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SesamDownloadError);
    expect((err as Error).message).toBe("Source SESAM : échec après 3 essais (TypeError ECONNRESET)");
  });
  it.each([
    ["404", () => new Response("", { status: 404 })],
    ["type de contenu", () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["taille", () => xmlResponse("x".repeat(200))],
  ])("%s : pas de reprise", async (_label, response) => {
    const fetchImpl = vi.fn(async () => response());
    const { result } = run(fetchImpl);
    await expect(result).rejects.toBeInstanceOf(SesamDownloadError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("un code suspect n'entre pas dans le journal", () => {
    expect(safeErrorCode({ cause: { code: "ECONNRESET" } })).toBe("ECONNRESET");
    expect(safeErrorCode({ code: "Nom de quelqu'un" })).toBeNull();
    expect(safeErrorCode(null)).toBeNull();
  });
});
