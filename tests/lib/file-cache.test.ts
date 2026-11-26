import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetFileCacheRelease, dropWithDd, largeFilesUnder, lastFileCacheRelease, releaseFileCacheOnce, startFileCacheRelease } from "../../src/lib/file-cache.js";

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

describe("releaseFileCacheOnce : dd qui échoue partout", () => {
  beforeEach(() => _resetFileCacheRelease());

  it("tous les fichiers en échec (dd autre que GNU) : la minuterie s'arrête", async () => {
    const outcome = await releaseFileCacheOnce({ cachedFileBytes: () => 500 * MO, thresholdBytes: 128 * MO, files: () => ["a", "b"], drop: async () => "failed" });
    expect(outcome).toBe("stop");
    expect(lastFileCacheRelease()).toMatchObject({ files: 0, error: "dd_failed" });
  });
});

describe("startFileCacheRelease : la minuterie", () => {
  beforeEach(() => { _resetFileCacheRelease(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("premier contrôle après deux minutes, puis toutes les cinq ; plus rien après l'arrêt", async () => {
    let checks = 0;
    const stop = startFileCacheRelease({ cachedFileBytes: () => { checks++; return 10 * MO; }, files: () => [], drop: async () => "ok" });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(checks).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(checks).toBe(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(checks).toBe(2);
    stop();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(checks).toBe(2);
  });

  it("sans compteurs de conteneur : un seul contrôle, jamais replanifié", async () => {
    let checks = 0;
    const stop = startFileCacheRelease({ cachedFileBytes: () => { checks++; return null; } });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(checks).toBe(1);
    stop();
  });

  it("une exception pendant un passage : nouvel essai cinq minutes plus tard", async () => {
    let checks = 0;
    const stop = startFileCacheRelease({ cachedFileBytes: () => { checks++; if (checks === 1) throw new Error("lecture impossible"); return 10 * MO; } });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(checks).toBe(2);
    stop();
  });
});

// Le vrai `dd` de GNU, sous Linux seulement (la CI) : le fichier doit rester identique, octet pour octet.
describe.skipIf(process.platform !== "linux")("dropWithDd : le vrai dd ne touche pas au fichier", () => {
  it("contenu, taille et date de modification inchangés", async () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-dd-"));
    try {
      const path = join(dir, "base=avec un espace.sqlite");
      const content = Buffer.alloc(3 * MO, 7);
      writeFileSync(path, content);
      const before = statSync(path);
      expect(await dropWithDd(path)).toBe("ok");
      const after = statSync(path);
      expect(after.size).toBe(before.size);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(readFileSync(path).equals(content)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
