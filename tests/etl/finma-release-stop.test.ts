// tâche osd.S05 : quand la collecte FINMA s'arrête sur un contrôle qui
// demande un regard humain, elle doit écrire le rapport lu ensuite par
// l'étape d'alerte (`scripts/alert-email.mjs`). Ce test provoque l'arrêt
// « variation FINMA supérieure à 10 % » avec des données simulées et
// vérifie le contenu du rapport écrit, sans toucher au réseau ni à R2.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  ingestOneSource: vi.fn(),
  ingestFromFinmaCsv: vi.fn(),
  ingestFinmaWarnings: vi.fn(),
  ingestGleif: vi.fn(),
  ingestFinmaSupervision: vi.fn(),
  attachSupervisoryOrganisations: vi.fn(),
  readPublishedSnapshots: vi.fn(),
  buildHistory: vi.fn(),
  buildBundle: vi.fn(),
  uploadZip: vi.fn(),
}));
vi.mock("../../etl/finma/ingest.js", () => ({ ingestOneSource: mocks.ingestOneSource, ingestFromFinmaCsv: mocks.ingestFromFinmaCsv }));
vi.mock("../../etl/finma/ingest-warnings.js", () => ({ ingestFinmaWarnings: mocks.ingestFinmaWarnings }));
vi.mock("../../etl/finma/ingest-gleif.js", () => ({ ingestGleif: mocks.ingestGleif }));
vi.mock("../../etl/finma/ingest-supervision.js", () => ({ ingestFinmaSupervision: mocks.ingestFinmaSupervision, attachSupervisoryOrganisations: mocks.attachSupervisoryOrganisations }));
vi.mock("../../etl/finma/history.js", () => ({
  readPublishedSnapshots: mocks.readPublishedSnapshots,
  buildHistory: mocks.buildHistory,
  versionDate: (v: string) => `${v.slice(0, 4)}-${v.slice(5, 7)}-${v.slice(8, 10)}`,
}));
vi.mock("../../etl/finma/bundle.js", () => ({ buildBundle: mocks.buildBundle }));
vi.mock("../../src/lib/r2.js", () => ({ uploadZip: mocks.uploadZip }));

import { runRelease } from "../../etl/finma/release.js";

describe("Collecte FINMA : arrêt sur contrôle et rapport d'alerte (osd.S05)", () => {
  let temp: string; let reportPath: string;

  beforeEach(() => {
    vi.resetAllMocks();
    temp = mkdtempSync(join(tmpdir(), "osd-finma-release-"));
    reportPath = join(temp, "rapport-arret.json");

    vi.stubEnv("BASE_URL", "https://example.test");
    vi.stubEnv("ADMIN_SECRET", "fictif");
    vi.stubEnv("USE_FIXTURE", "0");
    vi.stubEnv("FINMA_DRY_RUN", "0");
    vi.stubEnv("FINMA_CONTROL_REPORT_FILE", reportPath);

    const metadataPath = join(temp, "versions-production.json");
    writeFileSync(metadataPath, JSON.stringify({
      dataset: { current_version: "2026.01.01" },
      versions: [{ version: "2026.01.01", r2_key: "finma/2026.01.01/finma.zip", sha256: "a".repeat(64), size_bytes: 10, released_at: Date.now() - 86_400_000 }],
    }));
    vi.stubEnv("FINMA_PREVIOUS_VERSIONS_FILE", metadataPath);

    // 2 200 entités aujourd'hui contre 3 000 à la version précédente : -26,7 %, au-delà du seuil de 10 %.
    mocks.ingestFromFinmaCsv.mockResolvedValue({
      entities: Array.from({ length: 2_200 }, (_, i) => ({ uid: `CHE-${i}`, name: `Entité ${i}`, entity_type: "bank" })),
      stats: { unmappedTypes: {} },
    });
    mocks.ingestFinmaWarnings.mockResolvedValue({ warnings: Array.from({ length: 1_200 }, () => ({})), stats: { categoryCounts: {} } });
    mocks.ingestGleif.mockResolvedValue({ matched: 0, ambiguous_uids: 0 });
    mocks.ingestFinmaSupervision.mockResolvedValue({
      managers: Array.from({ length: 1_200 }, () => ({})),
      sros: Array.from({ length: 6 }, () => ({})),
      supervisoryOrganisations: Array.from({ length: 3 }, () => ({})),
      sources: { vvtr: { url: "https://finma.test/vvtr.xlsx", fetched_at: `${new Date().toISOString().slice(0, 10)}T00:00:00Z` } },
    });
    mocks.attachSupervisoryOrganisations.mockReturnValue({
      matched_source_rows: 1_190, source_rows: 1_200, registry_rows_with_value: 1_190,
      duplicate_source_rows: 0, ambiguous_uid_source_rows: 0, unmatched_source_rows: 10, type_mismatch_rows: 0,
    });
    mocks.readPublishedSnapshots.mockResolvedValue([{ version: "2026.01.01", entities: Array.from({ length: 3_000 }, () => ({})) }]);
    mocks.buildHistory.mockReturnValue({ changes: [], coverage: {} });
    mocks.buildBundle.mockResolvedValue({ zipPath: join(temp, "archive.zip"), sha256: "b".repeat(64), sizeBytes: 123 });
  });

  afterEach(() => { rmSync(temp, { recursive: true, force: true }); vi.unstubAllEnvs(); });

  it("arrête la publication sur une variation supérieure à 10 % sans rien construire ni publier", async () => {
    await expect(runRelease({ outDir: temp })).rejects.toThrow("Variation FINMA supérieure à 10 %");
    expect(mocks.buildBundle).not.toHaveBeenCalled();
    expect(mocks.uploadZip).not.toHaveBeenCalled();
  });

  it("écrit un rapport d'arrêt complet, sans aucune donnée personnelle", async () => {
    await expect(runRelease({ outDir: temp })).rejects.toThrow();
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.stop.control).toBe("variation_finma_superieure_10_pourcent");
    expect(report.stop.observed).toBe("2200 entités");
    expect(report.stop.expected).toContain("3000 entités");
    expect(report.stop.source).toContain("FINMA");
    expect(report.stop.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.stop.stays_served).toContain("précédente");
    expect(report.stop.options.length).toBeGreaterThanOrEqual(2);
    expect(report.stop.options.every((o: { level: string }) => ["AUTO", "RELU", "BOUTON"].includes(o.level))).toBe(true);
    // Aucun nom, UID ni autre donnée personnelle d'une entité ne doit fuiter dans le rapport.
    expect(JSON.stringify(report)).not.toMatch(/CHE-\d|Entité \d/);
  });

  it("ne garde aucun rapport quand le contrôle réussit", async () => {
    mocks.readPublishedSnapshots.mockResolvedValue([{ version: "2026.01.01", entities: Array.from({ length: 2_210 }, () => ({})) }]);
    const result = await runRelease({ outDir: temp, dryRun: true });
    expect(result.entity_count).toBe(2_200);
    expect(() => readFileSync(reportPath, "utf8")).toThrow();
  });
});
