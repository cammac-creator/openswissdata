import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { _configureEmbedderForTests, _embedderWorkerPid, _resetEmbedderCache, embedQuery } from "../../src/mcp/embedder.js";

const stub = fileURLToPath(new URL("../helpers/embedding-worker-stub.mjs", import.meta.url));
const vivant = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const attendre = async (condition: () => boolean, ms = 3000) => {
  const fin = Date.now() + ms;
  while (!condition() && Date.now() < fin) await new Promise(r => setTimeout(r, 20));
  return condition();
};

describe("processus isolé du modèle de recherche", () => {
  beforeEach(() => _configureEmbedderForTests({ workerPath: stub, idleMs: 250, requestMs: 2000 }));
  afterEach(() => _resetEmbedderCache());

  it("rend un vrai Float32Array de 768 valeurs", async () => {
    const vecteur = await embedQuery("  café  ");
    expect(vecteur).toBeInstanceOf(Float32Array);
    expect(vecteur.length).toBe(768);
    expect(vecteur[4]).toBeCloseTo(0.104, 5);
  });

  it("sert deux recherches simultanées par le même processus", async () => {
    const [a, b] = await Promise.all([embedQuery("lent un"), embedQuery("deux")]);
    expect(a[7]).toBeCloseTo(0.107, 5);
    expect(b[4]).toBeCloseTo(0.104, 5);
  });

  it("s'arrête après l'inactivité, jamais pendant une recherche, puis repart", async () => {
    const lente = embedQuery("lent");
    const pid = _embedderWorkerPid()!;
    await lente;
    expect(vivant(pid)).toBe(true);
    expect(await attendre(() => _embedderWorkerPid() === null && !vivant(pid))).toBe(true);
    await embedQuery("retour");
    expect(_embedderWorkerPid()).not.toBe(pid);
  });

  it("rejette sans bloquer quand le processus tombe, puis redémarre", async () => {
    await expect(Promise.all([embedQuery("plantage"), embedQuery("lent aussi")])).rejects.toThrow("embedQuery");
    expect((await embedQuery("après")).length).toBe(768);
  });

  it("un processus muet est arrêté au délai de la requête", async () => {
    _configureEmbedderForTests({ workerPath: stub, idleMs: 250, requestMs: 200 });
    await expect(embedQuery("silence")).rejects.toThrow("timeout");
    expect(_embedderWorkerPid()).toBeNull();
  });

  it("refuse un texte vide sans lancer de processus", async () => {
    await expect(embedQuery("   ")).rejects.toThrow("empty input");
    expect(_embedderWorkerPid()).toBeNull();
  });
});
