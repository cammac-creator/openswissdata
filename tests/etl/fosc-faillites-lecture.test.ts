import { describe, expect, it } from "vitest";
import { postalResolverFromCsv } from "../../etl/fosc/communes.js";
import { classifyInsolvencyAvis, parseInsolvencyDetail } from "../../etl/fosc/insolvency.js";
import type { ListEntry } from "../../etl/fosc/list.js";
import { INSOLVENCY_BY_CODE, INSOLVENCY_SPECS, isRowEventType } from "../../etl/fosc/subrubrics.js";
import { FoscXmlError } from "../../etl/fosc/xml.js";
import { IDE, insolvencyXml, PERSON, type InsolvencyAvis } from "../helpers/fosc-insolvency-portal.js";

// Données inventées (dépôt public).
const DAY = "2026-10-20";
const TODAY = "2026-10-21";
const ID = "00000000-0000-4000-a000-000000000001";
const entry = (subRubric: string, extra: Partial<ListEntry> = {}): ListEntry => ({
  id: ID, subRubric, publicationDate: DAY, publicationState: "PUBLISHED", expirationDate: "2031-10-20", canton: "VD", ...extra,
});
const postal = () => null;

function classify(a: Omit<InsolvencyAvis, "id" | "date" | "cantons">, xml?: (x: string) => string) {
  const avis: InsolvencyAvis = { id: ID, date: DAY, cantons: ["VD"], ...a };
  const spec = INSOLVENCY_BY_CODE.get(avis.subRubric)!;
  const text = xml ? xml(insolvencyXml(avis)) : insolvencyXml(avis);
  return classifyInsolvencyAvis(entry(avis.subRubric), parseInsolvencyDetail(text, spec), spec, postal, TODAY);
}

describe("faillites : lecture du détail XML", () => {
  it("lit les blocs société au chemin exact, compte les marques de personne sans en lire le contenu", () => {
    const spec = INSOLVENCY_BY_CODE.get("NA03")!;
    const d = parseInsolvencyDetail(insolvencyXml({ id: ID, subRubric: "NA03", date: DAY, cantons: ["VD"],
      companies: [{ uid: IDE.sa1, legalForm: "0106", zip: "1000", town: "Lausanne", canton: "VD" }], persons: [{}],
      dates: { creditorHearingDate: "2026-11-02", entryDeadline: "2026-11-25" }, officeUid: IDE.revision }), spec);
    expect(d.id).toBe(ID);
    expect(d.schemaKnown).toBe(true);
    expect(d.companies).toEqual([{ uid: IDE.sa1, legalForm: "0106", canton: "VD", swissZipCode: "1000", town: "Lausanne", repeated: [] }]);
    expect(d.personMarkers).toBeGreaterThanOrEqual(3); // person, prename, dateOfBirth
    expect(d.debtorTypes.sort()).toEqual(["company", "person"]);
    expect(d).not.toHaveProperty("dates"); // aucune date de procédure lue (relecture du 24.10.2026)
    expect(JSON.stringify(d)).not.toContain("2026-11-25");
    expect(JSON.stringify(d)).not.toContain(PERSON.name);
    expect(JSON.stringify(d)).not.toContain(PERSON.birth);
    expect(JSON.stringify(d)).not.toContain(IDE.revision);
  });

  it("refuse un document malformé avec une erreur qui ne cite rien", () => {
    const spec = INSOLVENCY_BY_CODE.get("KK02")!;
    const xml = insolvencyXml({ id: ID, subRubric: "KK02", date: DAY, cantons: ["VD"], persons: [{}] });
    let caught: unknown;
    try { parseInsolvencyDetail(xml.replace("</content>", ""), spec); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(FoscXmlError);
    expect((caught as Error).message).not.toContain(PERSON.name);
  });

  it("chaque sous-rubrique a un chemin de bloc ; les « autres avis » et les codes inconnus ne sont jamais des lignes", () => {
    expect(INSOLVENCY_SPECS.map((s) => s.code)).toHaveLength(12 + 12 + 8 + 6);
    for (const s of INSOLVENCY_SPECS) expect(s.companyPaths.length).toBeGreaterThan(0);
    expect(isRowEventType("KK10")).toBe(false);
    expect(isRowEventType("NA11")).toBe(false);
    expect(isRowEventType("KK13")).toBe(false);
    expect(isRowEventType("HR01")).toBe(true);
    expect(isRowEventType("KK02")).toBe(true);
  });
});

describe("faillites : classement, structure inattendue = totaux seulement", () => {
  const sa = { uid: IDE.sa1, legalForm: "0106" } as const;

  it("une société seule, de la liste blanche, avec IDE : ligne", () => {
    expect(classify({ subRubric: "KK02", companies: [sa] })).toMatchObject({ kind: "row", row: { ide: IDE.sa1, canton: "VD" } });
  });

  it("un élément « company » à un chemin inconnu (schéma changé) : cas ambigu", () => {
    const c = classify({ subRubric: "KK02", companies: [sa] }, (x) => x.replace("</content>", `<guarantor><company><uid>${IDE.sa2}</uid></company></guarantor></content>`));
    expect(c).toMatchObject({ kind: "totals", outcome: "ambiguous" });
  });

  it("une marque de personne à un chemin inconnu : personne", () => {
    const c = classify({ subRubric: "KK02", companies: [sa] }, (x) => x.replace("</content>", `<coDebtor><dateOfBirth>${PERSON.birth}</dateOfBirth></coDebtor></content>`));
    expect(c).toMatchObject({ kind: "totals", outcome: "person", tally: { legal_form: "personne" } });
  });

  it("un débiteur de type « person » sans bloc personne : personne", () => {
    expect(classify({ subRubric: "KK02", companies: [sa], debtorType: "person" })).toMatchObject({ outcome: "person" });
  });

  it("un avenant « succession » sur un débiteur société : succession", () => {
    expect(classify({ subRubric: "KK02", companies: [sa], addition: "legacy" })).toMatchObject({ outcome: "estate", tally: { legal_form: "succession" } });
  });

  it("un avenant libre (« custom ») ou un avenant à un autre chemin : cas ambigu", () => {
    expect(classify({ subRubric: "KK02", companies: [sa], addition: "custom" })).toMatchObject({ outcome: "ambiguous" });
    const c = classify({ subRubric: "KK02", companies: [sa] }, (x) => x.replace("</content>", "<other><addition>none</addition></other></content>"));
    expect(c).toMatchObject({ outcome: "ambiguous" });
  });

  it("un IDE au chiffre de contrôle faux : sans IDE", () => {
    expect(classify({ subRubric: "KK02", companies: [{ uid: "CHE-200.000.002", legalForm: "0106" }] })).toMatchObject({ outcome: "no_uid" });
  });

  it("une échéance qui tombe demain : jamais enregistrée", () => {
    const spec = INSOLVENCY_BY_CODE.get("KK02")!;
    const d = parseInsolvencyDetail(insolvencyXml({ id: ID, subRubric: "KK02", date: DAY, cantons: ["VD"], companies: [sa] }), spec);
    expect(classifyInsolvencyAvis(entry("KK02", { expirationDate: "2026-10-22" }), d, spec, postal, TODAY)).toMatchObject({ outcome: "expiring" });
  });

  it("un avis d'essai est repéré", () => {
    const spec = INSOLVENCY_BY_CODE.get("LS01")!;
    expect(parseInsolvencyDetail(insolvencyXml({ id: ID, subRubric: "LS01", date: DAY, cantons: ["VD"], companies: [sa], testImport: true }), spec).testImport).toBe(true);
  });
});

describe("faillites : commune de l'adresse d'une société (rapprochement exact)", () => {
  const csv = [
    "postal_code,postal_code_suffix,locality,municipality,municipality_bfs_id,canton,language",
    "1000,25,Lausanne 25,Lausanne,5586,VD,fr",
    "1000,26,Lausanne 26,Lausanne,5586,VD,fr",
    "1800,0,Vevey,Vevey,5890,VD,fr",
    "1800,0,Corseaux,Corseaux,5882,VD,fr",
    "8001,0,Zürich,Zürich,261,ZH,de",
  ].join("\n");
  const resolve = postalResolverFromCsv(csv, 1);

  it("un NPA d'une seule commune suffit ; sinon le lieu doit être exactement une localité de ce NPA", () => {
    expect(resolve("1000", "Lausanne")).toEqual({ bfs: 5586, canton: "VD" });
    expect(resolve("1000", null)).toEqual({ bfs: 5586, canton: "VD" });
    expect(resolve("1800", "Vevey")).toEqual({ bfs: 5890, canton: "VD" });
    expect(resolve("1800", "Vevey ")).toEqual({ bfs: 5890, canton: "VD" });
    expect(resolve("1800", "vevey")).toBeNull(); // jamais de rapprochement approché
    expect(resolve("1800", null)).toBeNull();
    expect(resolve("9999", "Vevey")).toBeNull();
    expect(resolve("80010", "Zürich")).toBeNull();
    expect(resolve(null, "Zürich")).toBeNull();
  });

  it("refuse un répertoire trop court", () => {
    expect(() => postalResolverFromCsv(csv)).toThrow(/trop court/);
  });
});
