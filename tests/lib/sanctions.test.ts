import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { buildSanctionsDocument } from "../../etl/sanctions/build.js";
import { exactMatchKey } from "../../etl/finma/ingest-supervision.js";
import { parseSesamXml } from "../../etl/sanctions/parse.js";
import {
  _setSanctionsForTest,
  decodeSanctionsObject,
  exactSanctionKey,
  getSanctions,
  getSanctionsLastError,
  isSanctionsListCurrent,
  refreshSanctionsFromR2,
  SANCTIONS_R2_KEY,
  validateSanctionsDocument,
  type SanctionsDocument,
} from "../../src/lib/sanctions.js";

const xml = readFileSync(new URL("../../etl/sanctions/fixtures/sesam-sample.xml", import.meta.url), "utf8");
const doc = buildSanctionsDocument(parseSesamXml(xml), { sha256: "a".repeat(64), bytes: xml.length, collectedAt: "2026-11-04T12:00:00.000Z" });
const clone = (): SanctionsDocument => JSON.parse(JSON.stringify(doc));
const gz = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value)));

afterEach(() => _setSanctionsForTest(null));

describe("clé exacte", () => {
  it.each(["Acme  Foundry", " Acme Foundry ", "école", "ACME foundry"])("identique à exactMatchKey : %j", (value) => {
    expect(exactSanctionKey(value)).toBe(exactMatchKey(value));
  });
  it("garde la casse", () => expect(exactSanctionKey("ACME")).not.toBe(exactSanctionKey("Acme")));
});

describe("document servi", () => {
  it("un document valide passe", () => {
    expect(validateSanctionsDocument(clone()).counts).toEqual({ organisations: 2, vessels: 1 });
  });
  it.each<[string, (d: SanctionsDocument) => void]>([
    ["un genre inconnu", (d) => { (d.entries[0] as { kind: string }).kind = "individual"; }],
    ["une personne déclarée servie", (d) => { d.exclusion_proof.natural_persons_served = 1; }],
    ["un nom de personne déclaré servi", (d) => { d.exclusion_proof.organisation_names_carrying_person_served = 1; }],
    ["des comptes faux", (d) => { d.counts.organisations = 99; }],
    ["une date illisible", (d) => { d.list_date = "hier"; }],
    ["un autre schéma", (d) => { (d as { schema: string }).schema = "v2"; }],
  ])("refuse %s", (_label, change) => {
    const bad = clone();
    change(bad);
    expect(() => decodeSanctionsObject(gz(bad))).toThrow();
  });
});

describe("rechargement depuis R2", () => {
  it("charge le document et index par nom et par IMO", async () => {
    await refreshSanctionsFromR2(async (key) => { expect(key).toBe(SANCTIONS_R2_KEY); return gz(doc); });
    expect(getSanctions()?.byName.get("Old Acme")?.[0].type).toBe("former");
    expect(getSanctions()?.byImo.get("1234567")?.[0].kind).toBe("vessel");
    expect(getSanctionsLastError()).toBeNull();
  });
  it("une lecture ratée garde la version précédente, et le message ne cite pas le contenu", async () => {
    await refreshSanctionsFromR2(async () => gz(doc));
    await refreshSanctionsFromR2(async () => gzipSync(Buffer.from("TEMOIN pas du json")));
    expect(getSanctions()?.document.list_date).toBe("2026-11-04");
    expect(getSanctionsLastError()).not.toContain("TEMOIN");
  });
  it("avant la première collecte : rien de chargé, aucune exception", async () => {
    await refreshSanctionsFromR2(async () => { throw Object.assign(new Error("absent"), { name: "NoSuchKey" }); });
    expect(getSanctions()).toBeNull();
    expect(getSanctionsLastError()).toBe("NoSuchKey");
  });
});

describe("fraîcheur", () => {
  const at = (date: string) => Date.parse(`${date}T12:00:00Z`);
  it("trois jours : encore actuelle ; quatre : périmée", () => {
    expect(isSanctionsListCurrent("2026-11-04", at("2026-11-07"))).toBe(true);
    expect(isSanctionsListCurrent("2026-11-04", at("2026-11-08"))).toBe(false);
  });
});
