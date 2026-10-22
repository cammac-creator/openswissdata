import { describe, expect, it } from "vitest";
import { FoscXmlError, parseAvisDetail } from "../../etl/fosc/xml.js";
import { parseListPage } from "../../etl/fosc/list.js";
import { avisId, avisXml, IDE, WITNESSES } from "../helpers/fosc-portal.js";

describe("détail XML d'un avis HR (données synthétiques)", () => {
  it("lit l'IDE, la forme et le siège de la société, jamais ceux de l'organe de révision", () => {
    const xml = avisXml({
      id: avisId(1), subRubric: "HR02", date: "2026-10-20", canton: "VD",
      after: { uid: IDE.sa1, legalForm: "0106", seat: "Lausanne" },
      before: { uid: IDE.sa1, legalForm: "0106", seat: "Morges" },
      revisionUid: IDE.revision,
    });
    const d = parseAvisDetail(xml);
    expect(d.id).toBe(avisId(1));
    expect(d.testImport).toBe(false);
    expect(d.after).toEqual([{ uid: IDE.sa1, legalForm: "0106", seat: "Lausanne", repeated: false }]);
    expect(d.before).toEqual([{ uid: IDE.sa1, legalForm: "0106", seat: "Morges", repeated: false }]);
    expect(JSON.stringify(d)).not.toContain(IDE.revision);
    for (const w of WITNESSES) expect(JSON.stringify(d)).not.toContain(w);
  });

  it("décode les entités et les sections CDATA du siège", () => {
    const xml = `<p:publication xmlns:p="x"><meta><id>${avisId(2)}</id></meta><content><commonsNew><company><uid>${IDE.sa2}</uid><seat>Gen&#232;ve</seat><legalForm><![CDATA[0107]]></legalForm></company></commonsNew></content></p:publication>`;
    const d = parseAvisDetail(xml);
    expect(d.after).toEqual([{ uid: IDE.sa2, legalForm: "0107", seat: "Genève", repeated: false }]);
    expect(d.before).toEqual([]);
  });

  it("repère un avis d'essai", () => {
    const d = parseAvisDetail(avisXml({ id: avisId(3), subRubric: "HR01", date: "2026-10-20", canton: "ZH", testImport: true, after: { uid: IDE.sa1, legalForm: "0106", seat: "Zürich" } }));
    expect(d.testImport).toBe(true);
  });

  it("refuse une déclaration DOCTYPE, un document tronqué ou déséquilibré, sans citer le document", () => {
    const cases = [
      `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><publication><meta><id>${WITNESSES[0]}</id></meta></publication>`,
      `<publication><meta><id>${WITNESSES[0]}</id></meta>`,
      `<publication><meta><id>${WITNESSES[0]}</meta></id></publication>`,
      `<publication><meta><id>&inconnue;${WITNESSES[0]}</id></meta></publication>`,
      // Références numériques hors de XML 1.0 : jamais une RangeError (relecture du 22.10.2026).
      `<publication><meta><id>${WITNESSES[0]}&#x110000;</id></meta></publication>`,
      `<publication><meta><id>${WITNESSES[0]}&#1114112;</id></meta></publication>`,
      `<publication><meta><id>${WITNESSES[0]}&#0;</id></meta></publication>`,
      `<publication><meta><id>${WITNESSES[0]}&#xD800;</id></meta></publication>`,
      `<publication><content><commonsNew><company><seat>X&#x110000;</seat></company></commonsNew></content></publication>`,
    ];
    for (const xml of cases) {
      let caught: unknown;
      try { parseAvisDetail(xml); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(FoscXmlError);
      expect((caught as Error).message).not.toContain(WITNESSES[0]);
    }
  });
});

describe("détail XML : lecture bloc par bloc", () => {
  const base = { id: avisId(10), subRubric: "HR01", date: "2026-10-20", canton: "VD" } as const;

  it("plusieurs blocs company dans un même commonsNew : chaque champ reste dans son bloc", () => {
    const d = parseAvisDetail(avisXml({ ...base, after: [{ uid: null, legalForm: "0106", seat: "Lausanne" }, { uid: IDE.soleProp, legalForm: "0101", seat: "Lausanne" }] }));
    expect(d.after).toEqual([
      { uid: null, legalForm: "0106", seat: "Lausanne", repeated: false },
      { uid: IDE.soleProp, legalForm: "0101", seat: "Lausanne", repeated: false },
    ]);
  });

  it("plusieurs commonsNew (un bloc chacun) : même résultat", () => {
    const d = parseAvisDetail(avisXml({ ...base, layout: "commons", after: [{ uid: null, legalForm: "0106", seat: "Lausanne" }, { uid: IDE.soleProp, legalForm: "0101", seat: "Lausanne" }] }));
    expect(d.after.map((b) => [b.uid, b.legalForm])).toEqual([[null, "0106"], [IDE.soleProp, "0101"]]);
  });

  it("un champ répété dans un même bloc, même vide la première fois, marque le bloc", () => {
    const xml = `<p:publication xmlns:p="x"><meta><id>${avisId(11)}</id></meta><content><commonsNew><company><uid></uid><uid>${IDE.sa1}</uid><legalForm>0106</legalForm><seat>Lausanne</seat></company></commonsNew></content></p:publication>`;
    expect(parseAvisDetail(xml).after[0].repeated).toBe(true);
  });

  it("un identifiant d'avis répété est refusé", () => {
    expect(() => parseAvisDetail(`<publication><meta><id>${avisId(12)}</id><id>${avisId(13)}</id></meta></publication>`)).toThrow(FoscXmlError);
  });
});

describe("liste des avis", () => {
  it("ne garde que les métadonnées utiles, jamais le titre", () => {
    const page = parseListPage({
      total: 1,
      content: [{ meta: { id: avisId(4), subRubric: "HR03", publicationDate: "2026-10-20T00:00:00.000Z", publicationState: "PUBLISHED", expirationDate: null, cantons: ["GE"], title: { fr: WITNESSES[1] } } }],
    });
    expect(page.entries).toEqual([{ id: avisId(4), subRubric: "HR03", publicationDate: "2026-10-20", publicationState: "PUBLISHED", expirationDate: null, canton: "GE" }]);
    expect(JSON.stringify(page)).not.toContain(WITNESSES[1]);
  });

  it("refuse un identifiant d'avis qui n'est pas un UUID", () => {
    expect(() => parseListPage({ total: 1, content: [{ meta: { id: "../../etc", subRubric: "HR01", publicationDate: "2026-10-20" } }] })).toThrow(/identifiant/);
  });
});
