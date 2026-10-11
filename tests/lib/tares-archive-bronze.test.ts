import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readdirSync, writeFileSync, truncateSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ getObjectBuffer: download }));
import { readTaresArchive } from "../../src/lib/tares-archive.js";

// Panne du 07.10.2026 : chaque jour recopiait la même archive TARES (13 Mo) dans un nouveau dossier daté ;
// au quinzième exemplaire, le plafond de 200 Mo refusait toute lecture (catalogue en 503, MCP sur la copie embarquée).
let temp: string;
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const info = (bytes: Buffer, version = "2026.10.05") => ({ r2_key: `tares/${version}/tares.zip`, sha256: sha(bytes), size_bytes: bytes.length });
function place(offset: number, name: string, bytes?: Buffer, apparentSize?: number) {
  const folder = join(temp, "bronze/tares", day(offset)); mkdirSync(folder, { recursive: true });
  const path = join(folder, name + ".zip");
  if (bytes) writeFileSync(path, bytes); else { writeFileSync(path, ""); truncateSync(path, apparentSize); }
  return path;
}
const copies = (name: string) => readdirSync(join(temp, "bronze/tares")).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .filter(d => existsSync(join(temp, "bronze/tares", d, name + ".zip")));

beforeEach(() => { temp = mkdtempSync(join(tmpdir(), "osd-tares-bronze-")); vi.stubEnv("DATABASE_PATH", join(temp, "test.db")); download.mockReset(); });
afterEach(() => { rmSync(temp, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("bronze TARES : un seul exemplaire par empreinte", () => {
  it("réutilise l'archive lue un jour précédent sans la retélécharger", async () => {
    const bytes = Buffer.from("archive TARES fictive");
    place(3, sha(bytes), bytes);
    await expect(readTaresArchive(info(bytes))).resolves.toEqual(bytes);
    expect(download).not.toHaveBeenCalled();
    expect(copies(sha(bytes))).toEqual([day(3)]);
  });

  it("retire les doublons d'une même archive et ne bute plus sur le plafond", async () => {
    const bytes = Buffer.from("archive TARES fictive");
    place(1, sha(bytes), bytes);
    // Quinze anciens exemplaires de 14 Mo apparents (fichiers creux) : 210 Mo comptés avant le correctif.
    for (let offset = 2; offset <= 16; offset++) place(offset, sha(bytes), undefined, 14_000_000);
    const other = Buffer.from("version précédente fictive");
    place(10, sha(other), other);
    await expect(readTaresArchive(info(bytes))).resolves.toEqual(bytes);
    expect(download).not.toHaveBeenCalled();
    expect(copies(sha(bytes))).toEqual([day(1)]);
    expect(copies(sha(other))).toEqual([day(10)]);
  });

  it("refuse une copie antérieure altérée au lieu de la servir", async () => {
    const bytes = Buffer.from("archive TARES fictive");
    place(2, sha(bytes), Buffer.from("contenu altéré"));
    await expect(readTaresArchive(info(bytes))).rejects.toThrow("altéré");
    expect(download).not.toHaveBeenCalled();
  });

  it("télécharge dans le dossier du jour quand aucune copie n'existe", async () => {
    const bytes = Buffer.from("archive TARES fictive");
    download.mockResolvedValue(bytes);
    await expect(readTaresArchive(info(bytes))).resolves.toEqual(bytes);
    expect(download).toHaveBeenCalledOnce();
    expect(copies(sha(bytes))).toEqual([day(0)]);
  });
});
