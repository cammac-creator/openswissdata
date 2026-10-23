import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchBronze } from "../../etl/shared/bronze.js";
import { fetchAndHash, type SourceCanary } from "../../scripts/monitor-sources.js";

// Relevé du 23.10.2026 : la FINMA sert au hasard des fichiers vides avec HTTP 200 (uid.csv et classeurs).
// Une réponse vide est réessayée ; elle n'est jamais écrite dans le bronze ni prise pour la source.
const sequence = (bodies: string[]) => {
  let call = 0;
  return vi.fn(async () => new Response(bodies[Math.min(call++, bodies.length - 1)]));
};

describe("Téléchargement brut : réponse vide réessayée", () => {
  let temp: string;
  beforeEach(() => { temp = mkdtempSync(join(tmpdir(), "osd-bronze-vide-")); });
  afterEach(() => { rmSync(temp, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  it("garde le premier fichier plein après des réponses vides", async () => {
    const fetcher = sequence(["", "", "uid;name\n1;A\n"]);
    vi.stubGlobal("fetch", fetcher);
    const path = await fetchBronze("https://www.finma.ch/fictif/uid.csv", temp, "uid.csv", {}, 12, { delayMs: 0 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(readFileSync(path, "utf8")).toBe("uid;name\n1;A\n");
    expect(JSON.parse(readFileSync(`${path}.meta.json`, "utf8")).bytes).toBe(13);
  });

  it("échoue sans rien écrire quand toutes les réponses restent vides", async () => {
    const fetcher = sequence([""]);
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchBronze("https://www.finma.ch/fictif/uid.csv", temp, "uid.csv", {}, 12, { attempts: 4, delayMs: 0 }))
      .rejects.toThrow("Taille de source invalide");
    expect(fetcher).toHaveBeenCalledTimes(4);
    const folder = join(temp, "bronze", new Date().toISOString().slice(0, 10));
    expect(() => readFileSync(join(folder, "uid.csv"))).toThrow();
  });

  it("ne réessaie pas une erreur HTTP", async () => {
    const fetcher = vi.fn(async () => new Response("indisponible", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchBronze("https://www.finma.ch/fictif/uid.csv", temp, "uid.csv", {}, 12, { delayMs: 0 }))
      .rejects.toThrow("HTTP 503");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Canari : réponse vide réessayée", () => {
  let temp: string;
  const source: SourceCanary = { id: "source.fictive.vide", url: "https://example.test/donnees", mode: "json-shape", description: "Source de test" };
  beforeEach(() => { temp = mkdtempSync(join(tmpdir(), "osd-canari-vide-")); vi.stubEnv("CANARY_BRONZE_DIR", temp); });
  afterEach(() => { rmSync(temp, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("contrôle le premier contenu plein", async () => {
    const raw = '{"data":[{"code":"01"}]}';
    const fetcher = sequence(["", raw]);
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchAndHash(source, { delayMs: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(Buffer.byteLength(raw));
  });

  it.each(["json-shape", "csv-shape", "document", "raw", "xlsx-shape"] as const)("échoue sans rien écrire quand la source reste vide (%s)", async (mode) => {
    const fetcher = sequence([""]);
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchAndHash({ ...source, mode }, { attempts: 3, delayMs: 0 })).rejects.toThrow("Réponse vide");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(readdirSync(temp)).toHaveLength(0);
  });
});
