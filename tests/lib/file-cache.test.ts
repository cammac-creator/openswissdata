import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetFileCacheRelease, largeFilesUnder, lastFileCacheRelease, releaseFileCacheOnce } from "../../src/lib/file-cache.js";

// Cache des gros fichiers (26.11.2026) : le noyau le garde, l'hébergeur le facture ; on le rend au-delà d'un seuil.
const MO = 1024 * 1024;

describe("releaseFileCacheOnce", () => {
  beforeEach(() => _resetFileCacheRelease());

  it("sans compteurs de conteneur (poste de développement) : rien n'est tenté, la minuterie s'arrête", async () => {
    const dropped: string[] = [];
    const outcome = await releaseFileCacheOnce({ cachedFileBytes: () => null, files: () => ["a"], drop: async (p) => { dropped.push(p); return "ok"; } });
    expect(outcome).toBe("stop");
    expect(dropped).toEqual([]);
    expect(lastFileCacheRelease()).toBeNull();
  });

  it("sous le seuil : le cache est laissé, aucun fichier touché", async () => {
    const dropped: string[] = [];
    const outcome = await releaseFileCacheOnce({ cachedFileBytes: () => 100 * MO, thresholdBytes: 128 * MO, files: () => ["a"], drop: async (p) => { dropped.push(p); return "ok"; } });
    expect(outcome).toBe("idle");
    expect(dropped).toEqual([]);
    expect(lastFileCacheRelease()).toBeNull();
  });

  it("au-dessus du seuil : chaque fichier est rendu une fois, avant et après relevés", async () => {
    const dropped: string[] = [];
    const readings = [957 * MO, 40 * MO];
    const outcome = await releaseFileCacheOnce({
      cachedFileBytes: () => readings.shift() ?? 0,
      thresholdBytes: 128 * MO,
      files: () => ["base", "modele-1", "modele-2"],
      drop: async (p) => { dropped.push(p); return "ok"; },
      now: () => new Date("2026-11-26T15:00:00.000Z"),
    });
    expect(outcome).toBe("released");
    expect(dropped).toEqual(["base", "modele-1", "modele-2"]);
    expect(lastFileCacheRelease()).toEqual({ at: "2026-11-26T15:00:00.000Z", files: 3, before_file_bytes: 957 * MO, after_file_bytes: 40 * MO, error: null });
  });

  it("sans dd dans l'image : arrêt au premier fichier, erreur dite dans le relevé", async () => {
    const dropped: string[] = [];
    const outcome = await releaseFileCacheOnce({ cachedFileBytes: () => 500 * MO, thresholdBytes: 128 * MO, files: () => ["a", "b"], drop: async (p) => { dropped.push(p); return "unavailable"; } });
    expect(outcome).toBe("stop");
    expect(dropped).toEqual(["a"]);
    expect(lastFileCacheRelease()).toMatchObject({ files: 0, error: "dd_unavailable" });
  });

  it("un fichier en échec n'empêche pas les autres, et la minuterie continue", async () => {
    const outcome = await releaseFileCacheOnce({ cachedFileBytes: () => 500 * MO, thresholdBytes: 128 * MO, files: () => ["a", "b", "c"], drop: async (p) => (p === "b" ? "failed" : "ok") });
    expect(outcome).toBe("released");
    expect(lastFileCacheRelease()).toMatchObject({ files: 2, error: "dd_failed" });
  });
});

describe("largeFilesUnder", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "osd-cache-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("ne garde que les fichiers d'au moins la taille demandée, sous-dossiers compris", () => {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "petit.json"), "x");
    writeFileSync(join(dir, "a", "gros.onnx"), Buffer.alloc(2048));
    writeFileSync(join(dir, "a", "b", "gros.bin"), Buffer.alloc(4096));
    expect(largeFilesUnder(dir, 1024).sort()).toEqual([join(dir, "a", "b", "gros.bin"), join(dir, "a", "gros.onnx")]);
  });

  it("dossier absent : liste vide, jamais une erreur", () => {
    expect(largeFilesUnder(join(dir, "absent"))).toEqual([]);
  });
});
