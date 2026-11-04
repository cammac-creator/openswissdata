import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSanctionsDocument, checkSanctionsDocument, SanctionsControlError } from "../../etl/sanctions/build.js";
import { carriesPersonName, emptyPersonIndex, organisationNameIsWithheld, parseSesamXml, personCheckKey, SesamXmlError, type PersonNameIndex } from "../../etl/sanctions/parse.js";
import { reviewHash } from "../../etl/sanctions/reviewed.js";

const xml = readFileSync(new URL("../../etl/sanctions/fixtures/sesam-sample.xml", import.meta.url), "utf8");
const source = { sha256: "a".repeat(64), bytes: xml.length, collectedAt: "2026-11-04T12:00:00.000Z" };
const NOW = Date.parse("2026-11-04T12:00:00Z");

describe("lecture du fichier SESAM (fictif)", () => {
  const parsed = parseSesamXml(xml);
  const byId = new Map(parsed.entries.map((e) => [e.id, e]));

  it("rend la date de la liste", () => expect(parsed.listDate).toBe("2026-11-04"));

  it("organisation : noms, programme, date, pays en code ISO ; le type de partie de nom ne décide de rien", () => {
    expect(byId.get("200")).toEqual({
      id: "200",
      kind: "organisation",
      names: [
        { type: "primary", value: "Acme Foundry & Forge LLC" },
        { type: "primary", value: "Акме Литейная" },
        { type: "alias", value: "AFF" },
        { type: "former", value: "Old Acme" },
      ],
      programmes: [{ id: "20", name: "Exampleland", origin: "EU" }],
      listed_on: "2022-03-04",
      countries: ["CH", "RU"],
      imo: null,
    });
  });

  it("bateau : numéro IMO seul tiré du texte, nom gardé même s'il égale celui d'une entrée « personne »", () => {
    expect(byId.get("400")?.kind).toBe("vessel");
    expect(byId.get("400")?.imo).toBe("1234567");
    expect(byId.get("400")?.names[0].value).toBe("Alias Personne Temoin");
    expect(parsed.vesselsNameEqualsPerson).toBe(1);
    expect(parsed.vesselsWithoutImo).toBe(0);
  });

  it("une radiation vaut quelle que soit sa position dans le fichier", () => {
    expect(byId.has("300")).toBe(false);
    expect(byId.has("500")).toBe(false);
  });

  it("nom principal portant une personne : entrée écartée et comptée ; « named after » gardé et compté", () => {
    expect(byId.has("350")).toBe(false);
    expect(parsed.excluded.organisations_primary_name_carries_person).toBe(1);
    expect(byId.has("360")).toBe(true);
    expect(parsed.organisationNamesHonouringAPersonKept).toBe(1);
  });

  it.each([
    ["balise de personne inconnue", xml.replace('<target ssid="400">\n    <object object-type="vessel">', '<target ssid="400">\n    <person>').replace('<other-information ssid="4003">IMO Number: 1234567</other-information>\n    </object>', "</person>")],
    ["genre d'objet inconnu", xml.replace('object-type="vessel"', 'object-type="aircraft"')],
    ["type de modification inconnu", xml.replace('modification-type="amended"', 'modification-type="suspended"')],
    ["type de liste inattendu", xml.replace('list-type="whole-list"', 'list-type="delta"')],
    ["racine inattendue", xml.replace(/swiss-sanctions-list/g, "autre-liste")],
    ["DOCTYPE", xml.replace("<swiss-sanctions-list list-type", '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><swiss-sanctions-list list-type')],
    ["document tronqué", xml.slice(0, xml.length - 40)],
    ["entrée radiée modifiée ensuite", xml.replace('modification-type="amended" effective-date="2025-06-03" enactment-date="2025-06-03" publication-date="2025-06-03"', 'modification-type="amended" effective-date="2025-07-03" enactment-date="2025-07-03" publication-date="2025-07-03"')],
    ["programme inconnu", xml.replace('<sanctions-set ssid="4387" lang="eng">', '<sanctions-set ssid="9" lang="eng">').replace('<sanctions-set ssid="4387" lang="fre">', '<sanctions-set ssid="9" lang="fre">')],
    ["numéro en double", xml.replace('<target ssid="360">', '<target ssid="350">')],
  ])("refus : %s", (_label, altered) => {
    expect(() => parseSesamXml(altered)).toThrow(SesamXmlError);
  });

  it("un message d'erreur ne cite jamais un extrait du fichier", () => {
    try {
      parseSesamXml(xml.replace('object-type="vessel"', 'object-type="TEMOIN"'));
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("TEMOIN");
    }
  });
});

describe("nom qui porte une personne", () => {
  const persons: PersonNameIndex = {
    ...emptyPersonIndex(),
    names: new Set([personCheckKey("Pavel Temoinov"), personCheckKey("Ali Bo"), personCheckKey("Solo")]),
    pairs: new Set(["ivanovich temoinchuk"]),
    given: new Set(["maria"]),
    family: new Set(["exemplova"]),
  };
  it.each([
    ["Pavel Temoinov", true],
    ["PAVEL-TEMOINOV Trading", true],
    ["Network of Pavel Temoinov", true],
    ["Solo", true],
    ["Haji Exemple Hawala", true],
    ["Ivanovich Temoinchuk Hawala", true], // fragment contigu d'un nom plus long
    ["Maria Exemplova Foundation", true], // prénom et nom connus, même si ce couple n'est pas sur la liste
    ["Exemplova Maria Foundation", false],
    ["Ali Bo Trading", false], // moins de huit caractères à l'intérieur d'un nom : trop court pour conclure
    ["Solo Trading", false],
    ["Temoinov Bank", false],
    ["Plant named after A. B. Exemplov", false],
  ])("%s → %s", (value, expected) => {
    expect(carriesPersonName(value, persons)).toBe(expected);
  });
  it("un couple qui contient une particule ne prouve rien : « al islam » n'entre pas dans l'index", () => {
    const body = `<swiss-sanctions-list list-type="whole-list" date="2026-11-04"><sanctions-program ssid="20"><program-key lang="eng">E</program-key><sanctions-set ssid="1" lang="eng">x</sanctions-set><origin>EU</origin></sanctions-program><target ssid="1"><individual><identity ssid="2" main="true"><name ssid="3" name-type="primary-name"><name-part order="1" name-part-type="whole-name"><value>Saif Al Islam Exemple</value></name-part></name></identity></individual><modification modification-type="listed"/><sanctions-set-id>1</sanctions-set-id></target></swiss-sanctions-list>`;
    const index = parseSesamXml(body).personIndex;
    expect(index.pairs.has("al islam")).toBe(false);
    expect(index.pairs.has("saif al")).toBe(false);
    expect(index.pairs.has("islam exemple")).toBe(true);
  });
  it("la relecture l'emporte sur la règle, et un nom absent des listes suit la règle", () => {
    expect(organisationNameIsWithheld("Pavel Temoinov Trading", persons)).toBe(true);
    expect(organisationNameIsWithheld("Exemple Neutre Trading", persons)).toBe(false);
  });
  it("les listes relues ne contiennent que des empreintes, jamais un nom", () => {
    const source = readFileSync(new URL("../../etl/sanctions/reviewed.ts", import.meta.url), "utf8");
    const quoted = [...source.matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]);
    expect(quoted.length).toBeGreaterThan(0);
    for (const value of quoted) expect(value).toMatch(/^[0-9a-f]{16}$/);
    expect(reviewHash("exemple")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("contrôles avant écriture", () => {
  const doc = buildSanctionsDocument(parseSesamXml(xml), source);
  const big = { ...doc, counts: { organisations: 2872, vessels: 708 } };

  it("volumes attendus : accepté", () => {
    expect(() => checkSanctionsDocument(big, { now: NOW, previous: null, acceptDrop: false })).not.toThrow();
  });
  it("sous le plancher : arrêt", () => {
    expect(() => checkSanctionsDocument(doc, { now: NOW, previous: null, acceptDrop: false })).toThrow(SanctionsControlError);
  });
  it("liste trop ancienne : arrêt", () => {
    expect(() => checkSanctionsDocument(big, { now: NOW + 5 * 86_400_000, previous: null, acceptDrop: false })).toThrow(SanctionsControlError);
  });
  it("baisse de plus de 15 % : arrêt, sauf adoption explicite", () => {
    const previous = { organisations: 4000, vessels: 708 };
    expect(() => checkSanctionsDocument(big, { now: NOW, previous, acceptDrop: false })).toThrow(SanctionsControlError);
    expect(() => checkSanctionsDocument(big, { now: NOW, previous, acceptDrop: true })).not.toThrow();
  });
  it("trop de bateaux sans IMO : arrêt", () => {
    expect(() => checkSanctionsDocument({ ...big, vessels_without_imo: 100 }, { now: NOW, previous: null, acceptDrop: false })).toThrow(SanctionsControlError);
  });
});
