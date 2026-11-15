/**
 * Inscription au registre TVA lue dans le registre IDE de l'OFS (15.11.2026,
 * `src/mcp/company/uid-register.ts`, branchée dans `company_check` et `/api/v1/company`).
 *
 * Aucun appel réseau réel : `fetch` est toujours simulé. Les réponses sont synthétiques (IDE
 * fictifs à chiffre de contrôle valide, sauf l'IDE d'AXA Leben AG déjà présent dans les fixtures
 * LINDAS/GLEIF), construites sur la forme relevée le 15.11.2026 : enveloppe SOAP,
 * `GetByUIDResult` vide pour un IDE inconnu, sinon des `organisationType` avec leurs espaces de
 * noms. Les champs que le module doit IGNORER (nom, adresse) y figurent exprès.
 */

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DAILY_LIMIT,
  MAX_RESPONSE_CHARS,
  MIN_INTERVAL_MS,
  lookupUidRegister,
  parseGetByUidResponse,
  parseXmlStrict,
  resetUidRegister,
  uidRegisterEnabled,
  UID_REGISTER_MENTION,
  UID_REGISTER_NOT_ENABLED,
  UID_REGISTER_PUBLIC_SERVICES_URL,
} from "../../src/mcp/company/uid-register.js";
import { ADDRESS_AND_PURPOSE_FORM_CODES, companyCheck } from "../../src/mcp/company/check.js";
import { COMPANY_SOURCES } from "../../src/mcp/company/sources.js";
import { LINDAS_ENDPOINT, resetLindasBreaker, resetLindasCache } from "../../src/mcp/company/lindas.js";
import { resetGleifBreaker, resetGleifCache } from "../../src/mcp/company/gleif.js";
import { resetZefixRest } from "../../src/mcp/company/zefix-rest.js";
import { parseUid } from "../../src/mcp/company/uid.js";
import { companyCheckHandler, companyCheckTool } from "../../src/mcp/tools/company-check.js";
import { PUBLIC_SOURCES } from "../../src/lib/public-sources.js";
import { getSource } from "../../etl/shared/sources/registry.js";
import { PRODUCT_SOURCES } from "../../etl/shared/sources/products.js";
import type { LiveDeps } from "../../src/mcp/company/types.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/company/${name}`, import.meta.url), "utf8"));
const LINDAS_AXA = fixture("lindas-axa-leben.json");
const GLEIF_AXA = fixture("gleif-axa-leben.json");

const DEBUT = Date.UTC(2026, 10, 15, 8, 0, 0); // 2026-11-15 08:00:00 UTC
const HEURE_MS = 60 * 60 * 1000;
const JOUR_MS = 24 * HEURE_MS;

const AXA_COMPACT = "CHE103137179";
const AXA_UID = "CHE-103.137.179";

/** IDE fictifs valides (chiffre de contrôle calculé), jamais une vraie société choisie à la main. */
function fictitiousUids(count: number): string[] {
  const poids = [5, 4, 3, 2, 7, 6, 5, 4];
  const out: string[] = [];
  for (let base = 90000000; out.length < count; base += 1) {
    const huit = String(base);
    const reste = 11 - (poids.reduce((t, p, i) => t + p * Number(huit[i]), 0) % 11);
    const controle = reste === 11 ? 0 : reste;
    if (controle === 10) continue;
    const compact = `CHE${huit}${controle}`;
    if (parseUid(compact).ok) out.push(compact);
  }
  return out;
}
const [UID_A, UID_B, UID_C, UID_D] = fictitiousUids(4);
const digitsOf = (compact: string): string => compact.slice(3);
const canonical = (compact: string): string => {
  const parsed = parseUid(compact);
  if (!parsed.ok) throw new Error("IDE fictif invalide");
  return parsed.uid;
};

const NS97 = 'xmlns="http://www.ech.ch/xmlns/eCH-0097/5"';
const NS98 = 'xmlns="http://www.ech.ch/xmlns/eCH-0098/5"';
const NS108 = 'xmlns="http://www.ech.ch/xmlns/eCH-0108/5"';
const NOM_A_NE_PAS_GARDER = "Nom Fictif A Ne Pas Garder SA";
const RUE_A_NE_PAS_GARDER = "Rue Fictive A Ne Pas Garder";

const envelope = (inner: string): string =>
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><GetByUIDResponse xmlns="http://www.uid.admin.ch/xmlns/uid-wse">${inner}</GetByUIDResponse></s:Body></s:Envelope>`;
const resultXml = (...organisations: string[]): string =>
  envelope(organisations.length === 0 ? "<GetByUIDResult/>" : `<GetByUIDResult>${organisations.join("")}</GetByUIDResult>`);

const vatBlock = (fields: string): string => `<vatRegisterInformation ${NS108}>${fields}</vatRegisterInformation>`;
const vatUid = (digits: string): string =>
  `<uidVat><uidOrganisationIdCategorie ${NS97}>CHE</uidOrganisationIdCategorie><uidOrganisationId ${NS97}>${digits}</uidOrganisationId></uidVat>`;

/** Un `organisationType` synthétique. `legalForm: null` retire l'élément ; `uidXml` remplace la structure IDE. */
function organisation(digits: string, opts: { legalForm?: string | null; vat?: string; uidXml?: string } = {}): string {
  const legalForm = opts.legalForm === undefined ? "0106" : opts.legalForm;
  const uidXml = opts.uidXml ?? `<uid ${NS97}><uidOrganisationIdCategorie>CHE</uidOrganisationIdCategorie><uidOrganisationId>${digits}</uidOrganisationId></uid>`;
  return (
    `<organisationType><organisation ${NS108}><organisationIdentification ${NS98}>${uidXml}` +
    `<organisationName ${NS97}>${NOM_A_NE_PAS_GARDER}</organisationName>` +
    (legalForm === null ? "" : `<legalForm ${NS97}>${legalForm}</legalForm>`) +
    `</organisationIdentification><address ${NS98}><street>${RUE_A_NE_PAS_GARDER}</street><town>Lieu Fictif</town></address></organisation>` +
    `<uidregInformation ${NS108}><uidregStatusEnterpriseDetail>3</uidregStatusEnterpriseDetail><uidregPublicStatus>1</uidregPublicStatus></uidregInformation>` +
    (opts.vat ?? "") +
    "</organisationType>"
  );
}

const xmlResponse = (body: string, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { "content-type": "text/xml; charset=utf-8", ...headers } });
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Réponse d'une société assujettie seule : inscrite, active, depuis le 01.10.2005, numéro TVA = son IDE. */
const registeredAlone = (compact: string): string =>
  resultXml(
    organisation(digitsOf(compact), {
      vat: vatBlock(`<vatStatus>2</vatStatus><vatEntryStatus>1</vatEntryStatus><vatEntryDate>2005-10-01</vatEntryDate>${vatUid(digitsOf(compact))}`),
    }),
  );

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

let horloge: number;
const now = () => horloge;
const deps = (fetchImpl: LiveDeps["fetch"]): LiveDeps => ({ fetch: fetchImpl, now });

beforeEach(() => {
  horloge = DEBUT;
  // Lecture ouverte pour ce fichier, quel que soit l'environnement ambiant de la suite.
  vi.stubEnv("OSD_UID_REGISTER", "");
  vi.stubEnv("ZEFIX_REST_USERNAME", "");
  vi.stubEnv("ZEFIX_REST_PASSWORD", "");
  resetUidRegister(now, { minIntervalMs: 0 });
  resetZefixRest(now, { minIntervalMs: 0 });
  resetLindasCache(now);
  resetLindasBreaker(now);
  resetGleifCache(now);
  resetGleifBreaker(now);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lecture non demandée ou coupée : aucune requête, fiche strictement inchangée", () => {
  it("OSD_UID_REGISTER=off : motif fixe, aucun appel à fetch", async () => {
    vi.stubEnv("OSD_UID_REGISTER", " OFF ");
    const fetchMock = vi.fn();
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toEqual({ available: false, reason: UID_REGISTER_NOT_ENABLED });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uidRegisterEnabled : seul « off » coupe, toute autre valeur laisse ouvert", () => {
    expect(uidRegisterEnabled({})).toBe(true);
    expect(uidRegisterEnabled({ OSD_UID_REGISTER: "" })).toBe(true);
    expect(uidRegisterEnabled({ OSD_UID_REGISTER: "on" })).toBe(true);
    expect(uidRegisterEnabled({ OSD_UID_REGISTER: "off" })).toBe(false);
    expect(uidRegisterEnabled({ OSD_UID_REGISTER: "Off" })).toBe(false);
  });

  const routedFetch = () =>
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.startsWith(UID_REGISTER_PUBLIC_SERVICES_URL)) return xmlResponse(registeredAlone(AXA_COMPACT));
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    });

  it("companyCheck sans `uidRegister` : aucune requête vers le registre IDE, pas de clé vat_register", async () => {
    const fetchMock = routedFetch();
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("vat_register" in result.fiche).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(UID_REGISTER_PUBLIC_SERVICES_URL))).toBe(false);
  });

  it("companyCheck avec `uidRegister` mais lecture coupée : aucune requête, pas de clé vat_register", async () => {
    vi.stubEnv("OSD_UID_REGISTER", "off");
    const fetchMock = routedFetch();
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [], uidRegister: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("vat_register" in result.fiche).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(UID_REGISTER_PUBLIC_SERVICES_URL))).toBe(false);
  });
});

describe("lookupUidRegister : requête unitaire et inscription normalisée", () => {
  it("POST SOAP GetByUID, un seul IDE dans le corps, sans redirection suivie", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => xmlResponse(registeredAlone(UID_A)));
    const result = await lookupUidRegister(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(UID_REGISTER_PUBLIC_SERVICES_URL);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    const headers = init?.headers as Record<string, string>;
    expect(headers.soapaction).toBe('"http://www.uid.admin.ch/xmlns/uid-wse/IPublicServices/GetByUID"');
    expect(headers["content-type"]).toBe("text/xml; charset=utf-8");
    expect(headers["user-agent"]).toMatch(/OpenSwissData/);
    const body = String(init?.body);
    expect(body).toContain(`<ech97:uidOrganisationId>${digitsOf(UID_A)}</ech97:uidOrganisationId>`);
    expect(body).toContain("<uid:GetByUID>");
    // Jamais l'opération de recherche ni un second identifiant : une entité déterminée par requête.
    expect(body).not.toMatch(/Search/);
    expect(body.match(/uidOrganisationId>/g)).toHaveLength(2);
    expect(result).toEqual({
      available: true,
      retrieved_at: new Date(DEBUT).toISOString(),
      found: true,
      data: { published: true, vat_registration: "registered", vat_entry_status: "active", vat_start_date: "2005-10-01", vat_end_date: null, vat_uid: canonical(UID_A) },
    });
  });

  it("membre d'un groupe TVA : inscrite, numéro TVA différent de l'IDE, pas de statut d'inscription inventé", async () => {
    const xml = resultXml(organisation(digitsOf(UID_A), { vat: vatBlock(`<vatStatus>2</vatStatus>${vatUid(digitsOf(UID_B))}`) }));
    const result = await lookupUidRegister(UID_A, deps(async () => xmlResponse(xml)));
    expect(result).toMatchObject({ found: true, data: { published: true, vat_registration: "registered", vat_entry_status: null, vat_start_date: null, vat_uid: canonical(UID_B) } });
  });

  it("vatStatus 3 → not_registered ; radiée à la TVA avec ses deux dates", async () => {
    const non = resultXml(organisation(digitsOf(UID_A), { vat: vatBlock("<vatStatus>3</vatStatus>") }));
    expect(await lookupUidRegister(UID_A, deps(async () => xmlResponse(non)))).toMatchObject({ data: { published: true, vat_registration: "not_registered", vat_uid: null } });
    const radiee = resultXml(
      organisation(digitsOf(UID_B), {
        vat: vatBlock(`<vatStatus>2</vatStatus><vatEntryStatus>2</vatEntryStatus><vatEntryDate>2010-01-01</vatEntryDate><vatLiquidationDate>2024-12-31</vatLiquidationDate>${vatUid(digitsOf(UID_B))}`),
      }),
    );
    expect(await lookupUidRegister(UID_B, deps(async () => xmlResponse(radiee)))).toMatchObject({
      data: { published: true, vat_registration: "registered", vat_entry_status: "deleted", vat_start_date: "2010-01-01", vat_end_date: "2024-12-31" },
    });
  });

  it("aucun bloc TVA dans la réponse → not_stated, jamais « non inscrite »", async () => {
    const xml = resultXml(organisation(digitsOf(UID_A), { legalForm: "0110" }));
    expect(await lookupUidRegister(UID_A, deps(async () => xmlResponse(xml)))).toMatchObject({
      found: true,
      data: { published: true, vat_registration: "not_stated", vat_entry_status: null, vat_start_date: null, vat_end_date: null, vat_uid: null },
    });
  });

  it.each([
    ["1", "unknown"],
    ["9", "unknown"],
    ["toString", "unknown"],
  ])("vatStatus %s → %s, jamais un statut deviné", async (code, attendu) => {
    const xml = resultXml(organisation(digitsOf(UID_A), { vat: vatBlock(`<vatStatus>${code}</vatStatus><vatEntryStatus>7</vatEntryStatus><vatEntryDate>2026-02-30</vatEntryDate>`) }));
    expect(await lookupUidRegister(UID_A, deps(async () => xmlResponse(xml)))).toMatchObject({
      data: { published: true, vat_registration: attendu, vat_entry_status: null, vat_start_date: null },
    });
  });

  it("numéro TVA illisible ou au chiffre de contrôle faux : null, le reste est gardé", async () => {
    const xml = resultXml(organisation(digitsOf(UID_A), { vat: vatBlock(`<vatStatus>2</vatStatus>${vatUid("123456789")}`) }));
    expect(await lookupUidRegister(UID_A, deps(async () => xmlResponse(xml)))).toMatchObject({ data: { published: true, vat_registration: "registered", vat_uid: null } });
  });

  it("minimisation : le nom et l'adresse de la réponse ne ressortent jamais", async () => {
    const result = await lookupUidRegister(UID_A, deps(async () => xmlResponse(registeredAlone(UID_A))));
    const texte = JSON.stringify(result);
    expect(texte).not.toContain(NOM_A_NE_PAS_GARDER);
    expect(texte).not.toContain(RUE_A_NE_PAS_GARDER);
    expect(texte).not.toContain("Lieu Fictif");
  });

  it("une entrée qui n'est pas la forme compacte validée est refusée sans appel réseau", async () => {
    const fetchMock = vi.fn();
    for (const bad of ["CHE-900.000.001", "900000001", `${UID_A}</x>`, ""]) {
      expect((await lookupUidRegister(bad, deps(fetchMock))).available).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("personnes morales seulement : rien de la TVA pour une autre forme juridique", () => {
  it.each([
    ["0101", "entreprise individuelle"],
    ["0103", "société en nom collectif"],
    ["0302", "forme absente de la liste blanche"],
    [null, "forme absente de la réponse"],
    ["01x6", "forme illisible"],
  ])("forme %s (%s) : published false, aucune donnée TVA gardée, même en cache", async (legalForm, _libelle) => {
    const xml = resultXml(
      organisation(digitsOf(UID_A), { legalForm, vat: vatBlock(`<vatStatus>2</vatStatus><vatEntryStatus>1</vatEntryStatus><vatEntryDate>2005-10-01</vatEntryDate>${vatUid(digitsOf(UID_A))}`) }),
    );
    const fetchMock = vi.fn(async () => xmlResponse(xml));
    const premier = await lookupUidRegister(UID_A, deps(fetchMock));
    expect(premier).toEqual({ available: true, retrieved_at: new Date(DEBUT).toISOString(), found: true, data: { published: false } });
    const second = await lookupUidRegister(UID_A, deps(fetchMock));
    expect(second).toEqual(premier);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(second)).not.toMatch(/registered|2005-10-01|vat_uid/);
  });

  it("la liste blanche est celle de la fiche (adresse et but), un seul exemplaire", async () => {
    const { ADDRESS_AND_PURPOSE_FORM_CODES: partagee } = await import("../../src/mcp/company/legal-forms.js");
    expect(ADDRESS_AND_PURPOSE_FORM_CODES).toBe(partagee);
    // Les formes qui peuvent porter le nom d'une personne n'y sont pas.
    for (const code of ["0101", "0103", "0104", "0105"]) expect(partagee.has(code)).toBe(false);
    // Chaque forme de la liste ouvre bien la TVA.
    for (const code of partagee) {
      resetUidRegister(now, { minIntervalMs: 0 });
      const xml = resultXml(organisation(digitsOf(UID_A), { legalForm: code, vat: vatBlock("<vatStatus>2</vatStatus>") }));
      expect(await lookupUidRegister(UID_A, deps(async () => xmlResponse(xml))), code).toMatchObject({ data: { published: true } });
    }
  });

  it("fiche : entité trouvée mais non publiée, aucun fait, motif court", async () => {
    const xml = resultXml(organisation(digitsOf(AXA_COMPACT), { legalForm: "0101", vat: vatBlock("<vatStatus>2</vatStatus>") }));
    const fetchMock = async (url: string | URL) => {
      const href = String(url);
      if (href.startsWith(UID_REGISTER_PUBLIC_SERVICES_URL)) return xmlResponse(xml);
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    };
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [], uidRegister: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fiche.vat_register).toMatchObject({ available: true, found: true, published: false, vat_registration: null, vat_uid: null, facts: [] });
    expect(result.fiche.vat_register?.reason).toMatch(/legal entities only/);
  });
});

describe("lookupUidRegister : non trouvé, échecs, formes inattendues", () => {
  it("résultat vide → non trouvé, gardé en cache une heure seulement", async () => {
    const fetchMock = vi.fn(async () => xmlResponse(resultXml()));
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toEqual({ available: true, retrieved_at: new Date(DEBUT).toISOString(), found: false, data: null });
    horloge += HEURE_MS - 1;
    await lookupUidRegister(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    horloge += 2;
    await lookupUidRegister(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("seulement une autre entité dans la réponse → non trouvé", async () => {
    const xml = resultXml(organisation(digitsOf(UID_B), { vat: vatBlock("<vatStatus>2</vatStatus>") }));
    expect(await lookupUidRegister(UID_A, deps(async () => xmlResponse(xml)))).toMatchObject({ available: true, found: false, data: null });
  });

  it("plusieurs éléments concordants : leur enregistrement commun ; divergents : unknown, jamais un choix", async () => {
    const un = organisation(digitsOf(UID_A), { vat: vatBlock("<vatStatus>2</vatStatus>") });
    const autre = organisation(digitsOf(UID_A), { vat: vatBlock("<vatStatus>3</vatStatus>") });
    expect(await lookupUidRegister(UID_A, deps(async () => xmlResponse(resultXml(un, un))))).toMatchObject({ data: { published: true, vat_registration: "registered" } });
    resetUidRegister(now, { minIntervalMs: 0 });
    expect(await lookupUidRegister(UID_A, deps(async () => xmlResponse(resultXml(un, autre))))).toMatchObject({ data: { published: true, vat_registration: "unknown", vat_uid: null } });
    resetUidRegister(now, { minIntervalMs: 0 });
    const nonPubliee = organisation(digitsOf(UID_A), { legalForm: "0101", vat: vatBlock("<vatStatus>2</vatStatus>") });
    expect(await lookupUidRegister(UID_A, deps(async () => xmlResponse(resultXml(un, nonPubliee))))).toMatchObject({ data: { published: false } });
  });

  const INATTENDUES: [string, string][] = [
    ["du JSON", JSON.stringify({ uid: "x" })],
    ["une page HTML", "<html><body>Maintenance</body></html>"],
    ["une faute SOAP rendue en 200", '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>Request_limit_exceeded</faultstring></s:Fault></s:Body></s:Envelope>'],
    ["un DOCTYPE", `<!DOCTYPE x [<!ENTITY e "v">]>${resultXml()}`],
    ["une entité inconnue", resultXml(organisation("&e;"))],
    ["une section CDATA", envelope("<GetByUIDResult><![CDATA[x]]></GetByUIDResult>")],
    ["un commentaire", envelope("<GetByUIDResult><!-- x --></GetByUIDResult>")],
    ["une balise mal fermée", envelope("<GetByUIDResult><organisationType></GetByUIDResult>")],
    ["un document tronqué", resultXml(organisation(digitsOf(UID_A))).slice(0, -20)],
    ["deux racines", `${resultXml()}${resultXml()}`],
    ["un IDE illisible dans l'identification", resultXml(organisation("12AB", {}))],
    ["une catégorie d'IDE autre que CHE", resultXml(organisation(digitsOf(UID_A), { uidXml: `<uid ${NS97}><uidOrganisationIdCategorie>ADM</uidOrganisationIdCategorie><uidOrganisationId>${digitsOf(UID_A)}</uidOrganisationId></uid>` }))],
    ["un élément étranger dans le résultat", envelope(`<GetByUIDResult>${organisation(digitsOf(UID_A))}<autre/></GetByUIDResult>`)],
    ["des éléments sans aucune identification", envelope("<GetByUIDResult><organisationType/></GetByUIDResult>")],
    ["deux blocs TVA pour une même entité", resultXml(organisation(digitsOf(UID_A), { vat: vatBlock("<vatStatus>2</vatStatus>") + vatBlock("<vatStatus>3</vatStatus>") }))],
    ["un document trop gros", resultXml(organisation(digitsOf(UID_A), { vat: `<pad>${"x".repeat(MAX_RESPONSE_CHARS)}</pad>` }))],
  ];

  it.each(INATTENDUES)("réponse 200 avec %s : forme inattendue, jamais mise en cache", async (_nom, body) => {
    const fetchMock = vi.fn(async () => xmlResponse(body));
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toEqual({ available: false, reason: "unexpected UID register response shape" });
    // Pas de cache : une seconde demande repart vers le service (une erreur isolée ne met pas en pause).
    await lookupUidRegister(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deux formes inattendues de suite ouvrent le disjoncteur ; il ne se referme qu'après une réponse valide", async () => {
    const fetchMock = vi.fn(async () => xmlResponse("<html/>"));
    await lookupUidRegister(UID_A, deps(fetchMock));
    await lookupUidRegister(UID_A, deps(fetchMock));
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toEqual({ available: false, reason: "source temporarily paused after errors" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([500, 503, 429])("HTTP %i : pause immédiate (dépassement de limite possible), corps jamais lu, rien en cache", async (status) => {
    const cancel = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => {
      const res = xmlResponse("<s:Fault>Request_limit_exceeded</s:Fault>", status);
      Object.defineProperty(res, "body", { value: { cancel } });
      return res;
    });
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toEqual({ available: false, reason: `UID register responded with HTTP ${status}` });
    expect(cancel).toHaveBeenCalledTimes(1);
    // Dès la première erreur : plus aucune requête, pour cet IDE comme pour un autre.
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toEqual({ available: false, reason: "source temporarily paused after errors" });
    expect(await lookupUidRegister(UID_B, deps(fetchMock))).toEqual({ available: false, reason: "source temporarily paused after errors" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    horloge += 60_001;
    await lookupUidRegister(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 avec Retry-After : la pause dure au moins ce délai", async () => {
    const fetchMock = vi.fn(async () => xmlResponse("", 429, { "retry-after": "300" }));
    await lookupUidRegister(UID_A, deps(fetchMock));
    horloge += 299_000;
    expect((await lookupUidRegister(UID_A, deps(fetchMock))).available).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 404 ou 400 : motif court, pas de pause, rien en cache", async () => {
    const fetchMock = vi.fn(async () => xmlResponse("", 404));
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toEqual({ available: false, reason: "UID register responded with HTTP 404" });
    await lookupUidRegister(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("panne réseau ou délai dépassé : motif fixe, l'erreur n'est jamais relayée", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("détail interne à ne jamais exposer");
    });
    const result = await lookupUidRegister(UID_A, deps(fetchMock));
    expect(result).toEqual({ available: false, reason: "UID register request failed or timed out" });
    expect(JSON.stringify(result)).not.toContain("détail interne");
  });

  it("délai dépassé pendant la lecture du corps", async () => {
    const fetchMock = vi.fn(async () => {
      const res = xmlResponse("x");
      Object.defineProperty(res, "text", {
        value: async () => {
          const err = new Error("délai");
          err.name = "TimeoutError";
          throw err;
        },
      });
      return res;
    });
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toEqual({ available: false, reason: "UID register request timed out while reading the response" });
  });

  it("taille annoncée démesurée : refusée sans lire le corps", async () => {
    const text = vi.fn(async () => "x");
    const fetchMock = vi.fn(async () => {
      const res = xmlResponse("x", 200, { "content-length": String(MAX_RESPONSE_CHARS * 4 + 1) });
      Object.defineProperty(res, "text", { value: text });
      return res;
    });
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toEqual({ available: false, reason: "unexpected UID register response shape" });
    expect(text).not.toHaveBeenCalled();
  });
});

describe("lecture XML stricte (unitaire)", () => {
  it("noms locaux sans préfixe, texte décodé, élément vide", () => {
    const root = parseXmlStrict('<?xml version="1.0"?><a:r xmlns:a="u"><b x="1 > 0">A &amp; B &#233; &#xE9;</b><c/></a:r>');
    expect(root).toEqual({ name: "r", text: "", children: [{ name: "b", text: "A & B é é", children: [] }, { name: "c", text: "", children: [] }] });
  });

  it("refuse tout ce qui sort du cadre", () => {
    for (const bad of ["", "texte", "<a>", "<a></b>", "<a><b></a></b>", "<a/><b/>", "x<a/>", "<a>&nbsp;</a>", "<a>&#0;</a>", "<a>&</a>", "<?pi x?><a/>", "<a><?pi x?></a>", "<a <b/>", "<1a/>"]) {
      expect(parseXmlStrict(bad), bad).toBeNull();
    }
    expect(parseXmlStrict(`${"<a>".repeat(40)}${"</a>".repeat(40)}`)).toBeNull();
    expect(parseXmlStrict(`<a>${"<b/>".repeat(4001)}</a>`)).toBeNull();
  });

  it("parseGetByUidResponse : résultat absent → non trouvé ; racine autre qu'une enveloppe → inattendu", () => {
    expect(parseGetByUidResponse(envelope(""), digitsOf(UID_A))).toEqual({ kind: "not_found" });
    expect(parseGetByUidResponse("<autre/>", digitsOf(UID_A))).toEqual({ kind: "unexpected" });
  });
});

describe("lookupUidRegister : cache, sérialisation, cadence, plafond quotidien", () => {
  it("cache 24 h : deuxième appel servi sans requête, nouvelle requête après 24 h + 1 ms", async () => {
    const fetchMock = vi.fn(async () => xmlResponse(registeredAlone(UID_A)));
    const premier = await lookupUidRegister(UID_A, deps(fetchMock));
    horloge += JOUR_MS - 1;
    expect(await lookupUidRegister(UID_A, deps(fetchMock))).toBe(premier);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    horloge += 2;
    await lookupUidRegister(UID_A, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("valeur en cache figée : un appelant ne peut pas la modifier", async () => {
    const result = await lookupUidRegister(UID_A, deps(async () => xmlResponse(registeredAlone(UID_A))));
    expect(Object.isFrozen(result)).toBe(true);
    if (result.available && result.data) expect(Object.isFrozen(result.data)).toBe(true);
  });

  it("deux IDE demandés en même temps : jamais deux requêtes en vol ; un troisième reçoit « busy » sans requête", async () => {
    let enVol = 0;
    let maxEnVol = 0;
    const liberer: (() => void)[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      enVol += 1;
      maxEnVol = Math.max(maxEnVol, enVol);
      await new Promise<void>((resolve) => liberer.push(resolve));
      enVol -= 1;
      const digits = /<ech97:uidOrganisationId>(\d{9})</.exec(String(init?.body))![1];
      return xmlResponse(registeredAlone(`CHE${digits}`));
    });
    const a = lookupUidRegister(UID_A, deps(fetchMock));
    const b = lookupUidRegister(UID_B, deps(fetchMock));
    await flush();
    // File pleine (une en cours, une en attente) : la troisième entité n'attend pas.
    expect(await lookupUidRegister(UID_C, deps(fetchMock))).toEqual({ available: false, reason: "UID register busy, try again later" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    liberer.shift()!();
    await a;
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    liberer.shift()!();
    expect(await b).toMatchObject({ found: true, data: { vat_uid: canonical(UID_B) } });
    expect(maxEnVol).toBe(1);
  });

  it("même IDE demandé deux fois en même temps : une seule requête", async () => {
    const fetchMock = vi.fn(async () => xmlResponse(registeredAlone(UID_A)));
    const [a, b] = await Promise.all([lookupUidRegister(UID_A, deps(fetchMock)), lookupUidRegister(UID_A, deps(fetchMock))]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("espace les requêtes réelles d'au moins l'intervalle minimal, même pour des IDE différents", async () => {
    resetUidRegister(now, { minIntervalMs: 60 });
    const envois: number[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      envois.push(Date.now());
      const digits = /<ech97:uidOrganisationId>(\d{9})</.exec(String(init?.body))![1];
      return xmlResponse(registeredAlone(`CHE${digits}`));
    });
    await lookupUidRegister(UID_A, deps(fetchMock));
    await lookupUidRegister(UID_B, deps(fetchMock));
    expect(envois).toHaveLength(2);
    expect(envois[1] - envois[0]).toBeGreaterThanOrEqual(55);
  });

  it("plafond quotidien : requêtes réelles comptées (échecs compris), puis motif fixe sans requête, remis à zéro le jour UTC suivant", async () => {
    resetUidRegister(now, { dailyLimit: 2, minIntervalMs: 0 });
    const fetchMock = vi.fn(async () => xmlResponse("", 404));
    await lookupUidRegister(UID_A, deps(fetchMock));
    await lookupUidRegister(UID_B, deps(fetchMock));
    expect(await lookupUidRegister(UID_C, deps(fetchMock))).toEqual({ available: false, reason: "UID register daily limit reached" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    horloge += JOUR_MS;
    await lookupUidRegister(UID_D, deps(fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("réglages par défaut : sous les 20 requêtes par minute indiquées par l'OFS, 500 par jour au plus", () => {
    expect(60_000 / MIN_INTERVAL_MS).toBeLessThan(20);
    expect(MIN_INTERVAL_MS).toBeGreaterThanOrEqual(4000);
    expect(DEFAULT_DAILY_LIMIT).toBe(500);
  });
});

describe("fiche société avec le registre IDE", () => {
  const routedFetch = (uidRegister: () => Response) =>
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.startsWith(UID_REGISTER_PUBLIC_SERVICES_URL)) return uidRegister();
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    });

  it("inscrite : bloc daté et sourcé, mention de l'OFS mot pour mot, not_covered et notice inchangés", async () => {
    const fetchMock = routedFetch(() => xmlResponse(registeredAlone(AXA_COMPACT)));
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [], uidRegister: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fiche } = result;
    const fact = (field: string, value: string) => ({ field, value, source_id: "bfs.uid_register", source_url: COMPANY_SOURCES["bfs.uid_register"].url, retrieved_at: new Date(DEBUT).toISOString() });
    expect(fiche.vat_register).toEqual({
      available: true,
      found: true,
      published: true,
      vat_registration: "registered",
      vat_entry_status: "active",
      vat_start_date: "2005-10-01",
      vat_end_date: null,
      vat_uid: AXA_UID,
      provenance: "OFS, registre IDE, https://www.uid.admin.ch",
      data_note: expect.stringContaining("normalised"),
      facts: [fact("vat_registration", "registered"), fact("vat_entry_status", "active"), fact("vat_start_date", "2005-10-01"), fact("vat_uid", AXA_UID)],
    });
    expect(fiche.vat_register?.provenance).toBe(UID_REGISTER_MENTION);
    expect(fiche.vat_register?.data_note).toMatch(/www\.uid\.admin\.ch/);
    expect(fiche.vat_register?.data_note).toMatch(/Legal entities only/);
    expect(fiche.not_covered).toEqual(["commercial_register_status", "fosc_publications", "seco_sanctions", "officers"]);
    expect(fiche.notice).toBe(
      "Unofficial copy assembled from public sources. Check the official registers before any decision: zefix.admin.ch, finma.ch, search.gleif.org.",
    );
    expect("commercial_register_status" in fiche).toBe(false);
    // L'inscription n'entre dans aucun recoupement.
    expect(fiche.cross_checks.every((c) => !c.sources.includes("bfs.uid_register"))).toBe(true);
    for (const f of fiche.vat_register!.facts) expect(() => getSource(f.source_id)).not.toThrow();
    expect(JSON.stringify(fiche)).not.toContain(NOM_A_NE_PAS_GARDER);
  });

  it("registre IDE en panne : bloc indisponible avec motif fixe, reste de la fiche servi", async () => {
    const fetchMock = routedFetch(() => xmlResponse("", 503));
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [], uidRegister: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fiche.vat_register).toMatchObject({ available: false, found: false, published: false, reason: "UID register responded with HTTP 503", vat_registration: null, facts: [] });
    expect(result.fiche.commercial_register.found).toBe(true);
    expect(result.fiche.lei.found).toBe(true);
  });

  it("IDE inconnu du registre : bloc disponible, non trouvé, aucun fait", async () => {
    const fetchMock = routedFetch(() => xmlResponse(resultXml()));
    const result = await companyCheck(AXA_UID, { fetch: fetchMock, now, finma: () => [], uidRegister: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fiche.vat_register).toMatchObject({ available: true, found: false, published: false, vat_registration: null, facts: [] });
  });

  it("résumé MCP : une ligne TVA datée avec la mention de l'OFS, aucun mot de verdict", async () => {
    const fetchMock = routedFetch(() => xmlResponse(registeredAlone(AXA_COMPACT)));
    const out = await companyCheckHandler({ uid: AXA_UID }, { fetch: fetchMock, now, finma: () => [], uidRegister: true });
    const text = out.content[0].text;
    expect(text).toContain(`VAT register (OFS, registre IDE, https://www.uid.admin.ch, read ${new Date(DEBUT).toISOString()}): registered, entry active, since 2005-10-01, VAT number ${AXA_UID}.`);
    expect(text).not.toMatch(/\b(compliant|trustworthy|safe|risky|suspicious|fraud|verified|valid)\b/i);
    expect(out.structured?.vat_register?.published).toBe(true);
  });

  it("résumé MCP : aucune ligne TVA quand le registre est en panne, non trouvé ou non publié", async () => {
    for (const reponse of [
      () => xmlResponse("", 503),
      () => xmlResponse(resultXml()),
      () => xmlResponse(resultXml(organisation(digitsOf(AXA_COMPACT), { legalForm: "0101", vat: vatBlock("<vatStatus>2</vatStatus>") }))),
    ]) {
      resetUidRegister(now, { minIntervalMs: 0 });
      const out = await companyCheckHandler({ uid: AXA_UID }, { fetch: routedFetch(reponse), now, finma: () => [], uidRegister: true });
      expect(out.content[0].text).not.toMatch(/VAT register/);
    }
  });

  it("résumé MCP sans `uidRegister` (deps injectées) : aucune requête vers le registre IDE", async () => {
    const fetchMock = routedFetch(() => xmlResponse(registeredAlone(AXA_COMPACT)));
    const out = await companyCheckHandler({ uid: AXA_UID }, { fetch: fetchMock, now, finma: () => [] });
    expect(out.content[0].text).not.toMatch(/VAT register/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(UID_REGISTER_PUBLIC_SERVICES_URL))).toBe(false);
  });

  it("description de l'outil : cite la source demandée et la limite aux personnes morales", () => {
    expect(companyCheckTool.description).toContain("OFS, registre IDE, https://www.uid.admin.ch");
    expect(companyCheckTool.description).toMatch(/legal entities only/);
  });
});

describe("registre des sources : bfs.uid_register", () => {
  it("même adresse que le registre unique, sans canari, licence propre, hors de toute archive vendue", () => {
    const source = getSource("bfs.uid_register");
    expect(source.url).toBe(UID_REGISTER_PUBLIC_SERVICES_URL);
    expect(source.institution).toBe("BFS");
    expect(source.canary).toBeUndefined();
    expect(source.licence.reference).toBe("PUBLIC-OFFICIAL-SOURCE-BFS-UID-OPEN-BY");
    expect(source.licence.date).toBe("2026-11-13");
    expect(COMPANY_SOURCES["bfs.uid_register"]).toEqual({ url: source.url, licence_reference: source.licence.reference });
    for (const ids of Object.values(PRODUCT_SOURCES)) expect(ids).not.toContain("bfs.uid_register");
  });

  it("listée par /api/v1/sources avec la même licence que le registre", () => {
    const entree = PUBLIC_SOURCES.find((s) => s.id === "bfs.uid_register");
    const source = getSource("bfs.uid_register");
    expect(entree?.url).toBe(source.url);
    expect(entree?.licence).toEqual({ reference: source.licence.reference, authority: source.licence.authority, jurisdiction: source.licence.jurisdiction });
    expect(entree?.description).toContain(UID_REGISTER_MENTION);
  });
});

describe("GET /api/v1/company/:uid avec le registre IDE (même fonction que company_check)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "osd-uid-register-"));
    vi.stubEnv("DATABASE_PATH", join(tmp, "test.sqlite"));
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "fictif");
    const { getDb } = await import("../../src/lib/db.js");
    const { _resetApiRateLimit } = await import("../../src/lib/api-rate-limit.js");
    getDb();
    _resetApiRateLimit();
  });
  afterEach(async () => {
    const { closeDb } = await import("../../src/lib/db.js");
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
  });

  const stubFetch = (): void => {
    vi.stubGlobal("fetch", async (url: string | URL) => {
      const href = String(url);
      if (href.startsWith(UID_REGISTER_PUBLIC_SERVICES_URL)) return xmlResponse(registeredAlone(AXA_COMPACT));
      return href.startsWith(LINDAS_ENDPOINT) ? jsonResponse(LINDAS_AXA) : jsonResponse(GLEIF_AXA);
    });
  };

  it("la fiche porte vat_register et `sources` cite alors bfs.uid_register", async () => {
    stubFetch();
    const { createApp } = await import("../../src/index.js");
    const res = await createApp().request(`/api/v1/company/${AXA_UID}`, { headers: { "x-real-ip": "192.0.2.91" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vat_register).toMatchObject({ available: true, found: true, published: true, vat_registration: "registered", provenance: UID_REGISTER_MENTION });
    const ids = body.sources.map((s: { id: string }) => s.id);
    expect(ids).toHaveLength(6);
    expect(ids).toContain("bfs.uid_register");
    expect(ids).not.toContain("ofrc.zefix_rest");
    const source = body.sources.find((s: { id: string }) => s.id === "bfs.uid_register");
    expect(source.institution).toBe("BFS");
    expect(source.url).toBe(UID_REGISTER_PUBLIC_SERVICES_URL);
  });

  it("lecture coupée : fiche et `sources` strictement comme avant", async () => {
    vi.stubEnv("OSD_UID_REGISTER", "off");
    stubFetch();
    const { createApp } = await import("../../src/index.js");
    const res = await createApp().request(`/api/v1/company/${AXA_UID}`, { headers: { "x-real-ip": "192.0.2.92" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect("vat_register" in body).toBe(false);
    const ids = body.sources.map((s: { id: string }) => s.id);
    expect(ids).toHaveLength(5);
    expect(ids).not.toContain("bfs.uid_register");
  });
});
