// Collecte FINMA et mouvements mensuels : le bloc part dans quality.json à côté de
// l'historique existant (inchangé), et un bloc hérité illisible arrête la publication
// avec un rapport d'alerte, au lieu de perdre en silence les mois figés.
// Données simulées et fictives, sans réseau ni R2 (même montage que finma-release-stop.test.ts).
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
import { MovementsInheritanceError } from "../../etl/finma/movements.js";

const versionOf = (d: Date) => `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
const today = versionOf(new Date());
const yesterday = versionOf(new Date(Date.now() - 86_400_000));
const entities = Array.from({ length: 2_200 }, (_, i) => ({ uid: `CHE-900.${String(i).padStart(6, "0")}`, name: `Entité fictive ${i}`, entity_type: "bank", licence_type: "Bank", source_list: "finma-uid-csv", source_url: "https://registre.exemple/" }));
const warnings = Array.from({ length: 1_200 }, (_, i) => ({ name: `Alerte fictive ${i}`, date_added: "2026-01-15", source_url: `https://alerte.exemple/fiche-${i}/`, source_list: "finma-warnings", warning_type: "unauthorized_provider" }));
const coverage = { available_from: "2026-07-23", available_until: "2026-10-21", snapshots: 2, gaps: [{ from: "2026.08.24", to: "2026.09.25", days: 32 }], interpretation: "Fictif." };

describe("Collecte FINMA : mouvements mensuels dans l'archive", () => {
  let temp: string; let reportPath: string;

  beforeEach(() => {
    vi.resetAllMocks();
    temp = mkdtempSync(join(tmpdir(), "osd-finma-mouvements-release-"));
    reportPath = join(temp, "rapport-arret.json");
    vi.stubEnv("BASE_URL", "https://example.test");
    vi.stubEnv("ADMIN_SECRET", "fictif");
    vi.stubEnv("USE_FIXTURE", "0");
    vi.stubEnv("FINMA_DRY_RUN", "0");
    vi.stubEnv("FINMA_CONTROL_REPORT_FILE", reportPath);
    const metadataPath = join(temp, "versions-production.json");
    writeFileSync(metadataPath, JSON.stringify({
      dataset: { current_version: yesterday },
      versions: [{ version: yesterday, r2_key: `finma/${yesterday}/finma.zip`, sha256: "a".repeat(64), size_bytes: 10, released_at: Date.now() - 86_400_000 }],
    }));
    vi.stubEnv("FINMA_PREVIOUS_VERSIONS_FILE", metadataPath);
    mocks.ingestFromFinmaCsv.mockResolvedValue({ entities: entities.map(e => ({ ...e })), stats: { unmappedTypes: {} } });
    mocks.ingestFinmaWarnings.mockResolvedValue({ warnings, stats: { categoryCounts: {} } });
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
    mocks.buildHistory.mockReturnValue({ changes: [], coverage });
    mocks.buildBundle.mockResolvedValue({ zipPath: join(temp, "archive.zip"), sha256: "b".repeat(64), sizeBytes: 123 });
  });

  afterEach(() => { rmSync(temp, { recursive: true, force: true }); vi.unstubAllEnvs(); });

  it("ajoute history.movements à côté de l'historique existant, inchangé, et le résume au contrôle", async () => {
    mocks.readPublishedSnapshots.mockResolvedValue([{ version: yesterday, entities: entities.slice(1), warnings: warnings.slice(1) }]);
    const result = await runRelease({ outDir: temp, dryRun: true });
    expect(result.registered).toBe(false);
    const input = mocks.buildBundle.mock.calls[0][0];
    const { movements, ...rest } = input.historyCoverage;
    expect(rest).toEqual(coverage);
    expect(movements).toMatchObject({ schema_version: 1, computed_in_version: today, resumptions: [] });
    const current = movements.months.at(-1);
    expect(current).toMatchObject({ status: "open" });
    expect(current.registry.totals.added).toBe(1);
    expect(current.warnings.appeared).toBe(1);
    expect(JSON.stringify(movements)).not.toMatch(/fictive|CHE-\d|exemple/);
    const control = JSON.parse(readFileSync(join(temp, `controle-${today}.json`), "utf8"));
    expect(control.movements).toMatchObject({ excluded_comparisons: 0, resumptions: [] });
    expect(control.history).toEqual(coverage);
  });

  it("arrête la publication sur un bloc hérité illisible, avec un rapport d'alerte sans donnée nominative", async () => {
    mocks.readPublishedSnapshots.mockResolvedValue([{
      version: yesterday, entities, warnings,
      quality: { history: { movements: { schema_version: 1, months: "illisible", resumptions: [] } } },
    }]);
    await expect(runRelease({ outDir: temp })).rejects.toThrow(MovementsInheritanceError);
    expect(mocks.buildBundle).not.toHaveBeenCalled();
    expect(mocks.uploadZip).not.toHaveBeenCalled();
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.stop.control).toBe("mouvements_herites_illisibles");
    expect(report.stop.source).toContain(yesterday);
    expect(report.stop.stays_served).toContain("précédente");
    expect(report.stop.options.every((o: { level: string }) => ["AUTO", "RELU", "BOUTON"].includes(o.level))).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/CHE-\d|fictive/);
  });
});
