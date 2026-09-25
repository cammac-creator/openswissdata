import { describe, it, expect } from "vitest";
import { canonicalUid, enrichWithGleif, type GleifRecord } from "../../etl/finma/ingest-gleif.js";
import { buildHistory } from "../../etl/finma/history.js";
import { computeDelta } from "../../etl/finma/delta.js";
import type { FinmaEntity } from "../../etl/finma/types.js";

const entity = (extra: Partial<FinmaEntity> = {}): FinmaEntity => ({
  name: "Société exemple", uid: "CHE-123.456.789", entity_type: "bank", licence_type: "Banque",
  source_list: "finma-uid-csv", source_url: "https://www.finma.ch/", ...extra,
});
const record = (lei = "ABCDEFGHIJKLMNOPQR12", uid = "CHE-123.456.789"): GleifRecord => ({ attributes: {
  lei, entity: { registeredAs: uid, legalAddress: { addressLines: ["Rue exemple 1"], city: "Lausanne", postalCode: "1000", country: "CH", region: "CH-VD" } },
  registration: { status: "ISSUED", lastUpdateDate: "2026-09-24T00:00:00Z" },
} });

describe("Qualité FINMA", () => {
  it("normalise le tiret Unicode sans rapprochement approximatif", () => {
    expect(canonicalUid("CHE‑123.456.789")).toBe("CHE-123.456.789");
    expect(canonicalUid("123.456.789")).toBeUndefined();
  });
  it("attribue un LEI seulement par UID exact et garde le statut FINMA inconnu", () => {
    const rows = [entity(), entity({ uid: "CHE-999.999.999" })];
    expect(enrichWithGleif(rows, [record()]).matched).toBe(1);
    expect(rows[0]).toMatchObject({ lei: "ABCDEFGHIJKLMNOPQR12", canton: "VD" });
    expect(rows[0].status).toBeUndefined();
    expect(rows[1].lei).toBeUndefined();
  });
  it("n'attribue pas les identifiants ambigus ou retirés", () => {
    const rows = [entity()];
    expect(enrichWithGleif(rows, [record(), record("ABCDEFGHIJKLMNOPQS34")]).ambiguous_uids).toBe(1);
    expect(rows[0].lei).toBeUndefined();
    const retired = record(); retired.attributes.registration!.status = "RETIRED";
    expect(enrichWithGleif(rows, [retired]).matched).toBe(0);
  });
  it("conserve plusieurs autorisations du même UID et voit celle retirée", () => {
    const bank = entity(), broker = entity({ entity_type: "securities_firm", licence_type: "Titres" });
    expect(computeDelta([bank, broker], [bank]).changes).toMatchObject([{ kind: "removed", entity_type: "securities_firm" }]);
  });
  it("annonce la lacune historique et ne présente pas l'enrichissement comme un changement FINMA", () => {
    const current = entity({ address: "Rue 1", address_source_url: "https://api.gleif.org/" });
    const result = buildHistory([{ version: "2026.08.24", entities: [entity()] }], { version: "2026.09.25", entities: [current] });
    expect(result.changes).toHaveLength(0);
    expect(result.coverage.gaps).toEqual([{ from: "2026.08.24", to: "2026.09.25", days: 32 }]);
  });
});
