/**
 * Tests du module d'outil MCP `company_check` (tâche osd.fiche, tâche 5).
 *
 * Module seul, PAS branché sur le serveur (`src/mcp/server.ts` ne doit jamais l'importer).
 * Aucun appel réseau : `deps.fetch` est une maquette qui rend les fixtures de la tâche 3/4,
 * et le UID invalide est rejeté par `companyCheck` AVANT tout appel réseau (voir
 * `src/mcp/company/uid.ts`), ce qui permet aussi de tester l'appel SANS `deps` (valeurs par
 * défaut) sans jamais toucher le réseau réel.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companyCheckHandler, companyCheckSchema, companyCheckTool } from "../../src/mcp/tools/company-check.js";
import { resetLindasCache } from "../../src/mcp/company/lindas.js";
import { resetGleifCache } from "../../src/mcp/company/gleif.js";
import { _resetDataLoaderCache, setFinmaVersion, type FinmaRegistryRow } from "../../src/mcp/data-loader.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/company/${name}`, import.meta.url), "utf8"));
const LINDAS_AXA = fixture("lindas-axa-leben.json");
const GLEIF_AXA = fixture("gleif-axa-leben.json");

const AXA_UID = "CHE-103.137.179"; // IDE réel, fixtures de la tâche 3/4
const DEBUT = Date.UTC(2026, 9, 6, 10, 0, 0); // 2026-10-06 10:00:00 UTC
const now = () => DEBUT;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function finmaRow(overrides: Partial<FinmaRegistryRow> = {}): FinmaRegistryRow {
  return {
    entity_type: "insurance",
    name: "AXA Leben AG",
    uid: AXA_UID,
    lei: "52990032J6E61LFTO024",
    licence_type: "Life insurance company",
    licence_type_de: "Lebensversicherer",
    licence_type_fr: "Assureur-vie",
    licence_type_it: "Assicurazione vita",
    licence_date: "2006-01-01",
    status: "authorised",
    canton: "ZH",
    city: "Winterthur",
    address: "",
    source_list: "finma-uid-csv",
    source_url: "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/",
    is_warning_listed: "false",
    ...overrides,
  };
}

/** Maquette de `fetch` : POST → LINDAS (fixture AXA), GET → GLEIF (fixture AXA). Jamais de réseau réel. */
function fetchStub(_url: string | URL, init?: RequestInit): Promise<Response> {
  if (init?.method === "POST") return Promise.resolve(jsonResponse(LINDAS_AXA));
  return Promise.resolve(jsonResponse(GLEIF_AXA));
}

const BANNED_VERDICT_WORDS = [
  "safe",
  "risky",
  "compliant",
  "verified",
  "trustworthy",
  "legitimate",
  "suspicious",
  "valid company",
];

function assertNoVerdictWords(text: string): void {
  const lower = text.toLowerCase();
  for (const word of BANNED_VERDICT_WORDS) {
    expect(lower).not.toContain(word);
  }
}

beforeEach(() => {
  resetLindasCache(now);
  resetGleifCache(now);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("companyCheckTool (module seul, non branché)", () => {
  it("expose le nom company_check", () => {
    expect(companyCheckTool.name).toBe("company_check");
    expect(companyCheckTool.inputSchema).toBe(companyCheckSchema);
  });

  // Relecture finale du 06.10.2026, point 5(a) : le schéma JSON refuse tout champ en plus de `uid`.
  it("le schéma JSON refuse tout champ en plus de `uid`", () => {
    expect(companyCheckSchema.additionalProperties).toBe(false);
  });

  it("n'est importé par aucun chemin dans src/mcp/server.ts (outil éteint)", () => {
    const serverSource = readFileSync(new URL("../../src/mcp/server.ts", import.meta.url), "utf8");
    expect(serverSource).not.toContain("company-check");
    expect(serverSource).not.toContain("company_check");
  });

  it("entrée invalide (zod) : uid absent → isError avec un message lisible", async () => {
    const res = await companyCheckHandler({}, { fetch: fetchStub, now, finma: () => [finmaRow()] });
    expect(res.isError).toBe(true);
    expect(res.structured).toBeUndefined();
    expect(res.content[0]?.text).toContain("Invalid input");
  });

  it("entrée invalide (zod) : uid trop court (moins de 9 caractères) → isError", async () => {
    const res = await companyCheckHandler({ uid: "CHE1234" }, { fetch: fetchStub, now, finma: () => [finmaRow()] });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Invalid input");
  });

  it("entrée invalide (zod) : champ supplémentaire refusé (entrée stricte)", async () => {
    const res = await companyCheckHandler(
      { uid: AXA_UID, top_k: 5 },
      { fetch: fetchStub, now, finma: () => [finmaRow()] },
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Invalid input");
  });

  it("IDE invalide (chiffre de contrôle faux) → isError avec la raison, sans appel réseau", async () => {
    let fetchCalled = false;
    const refusingFetch = (): Promise<Response> => {
      fetchCalled = true;
      return Promise.reject(new Error("ne doit jamais être appelé"));
    };
    const res = await companyCheckHandler(
      { uid: "CHE-123.456.000" }, // 9 chiffres, longueur correcte, chiffre de contrôle faux
      { fetch: refusingFetch, now, finma: () => [finmaRow()] },
    );
    expect(res.isError).toBe(true);
    expect(res.structured).toBeUndefined();
    expect(res.content[0]?.text.toLowerCase()).toContain("invalid uid");
    expect(fetchCalled).toBe(false);
  });

  it("sans deps (valeurs par défaut) : un IDE invalide reste rejeté avant tout accès réseau", async () => {
    // Ne touche jamais au réseau réel : parseUid échoue avant le premier `deps.fetch`.
    const res = await companyCheckHandler({ uid: "CHE-123.456.000" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text.toLowerCase()).toContain("invalid uid");
  });

  it("sans deps (valeurs par défaut) : `fetch` est lu sur `globalThis` À L'APPEL, pas capturé au chargement du module", async () => {
    let called = 0;
    vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
      called += 1;
      return fetchStub(...args);
    });
    const res = await companyCheckHandler({ uid: AXA_UID });
    expect(called).toBeGreaterThan(0);
    expect(res.isError).toBeUndefined();
    expect(res.structured?.commercial_register.found).toBe(true);
    // FINMA par défaut lit la copie embarquée (fichier local du dépôt) : jamais affirmé
    // `found` ici, ce dépôt de test n'a pas de fixture pour cette copie.
  });

  it("succès (AXA Leben AG, deps injectées) : structured = la fiche, texte lisible qui cite les sources", async () => {
    const res = await companyCheckHandler(
      { uid: AXA_UID },
      { fetch: fetchStub, now, finma: () => [finmaRow()] },
    );
    expect(res.isError).toBeUndefined();
    expect(res.structured).toBeDefined();
    const fiche = res.structured!;
    expect(fiche.uid).toBe(AXA_UID);
    expect(fiche.commercial_register.found).toBe(true);
    expect(fiche.finma.found).toBe(true);
    expect(fiche.lei.found).toBe(true);
    expect(fiche.cross_checks.length).toBeGreaterThan(0);
    expect(fiche.cross_checks.every((c) => c.result)).toBe(true); // noms identiques dans cette fixture

    const text = res.content[0]?.text ?? "";
    expect(text).toContain("LINDAS");
    expect(text).toContain("FINMA");
    expect(text).toContain("GLEIF");
    expect(text).toContain("identical");
    // Phrase claire plutôt que la liste de jetons `not_covered` (relecture finale du
    // 06.10.2026) : ni "commercial_register_status" ni les autres noms de champs internes
    // n'apparaissent, mais le sens reste présent en clair.
    expect(text).toContain("still registered");
    expect(text).toContain("FOSC");
    expect(text).toContain("SECO");
    expect(text).toContain("officers");
    expect(text).not.toContain("commercial_register_status");
    expect(text).toContain(fiche.notice);
    expect(text.length).toBeLessThan(2500); // résumé court : le `but` long reste coupé ici, entier dans `structured`
    assertNoVerdictWords(text);
  });

  // Relecture finale du 06.10.2026, point 3 : le texte cite la date de lecture FINMA
  // SEULEMENT quand la version FINMA servie est connue (registre PAR DÉFAUT, jamais un
  // registre injecté par les tests).
  it("version FINMA connue (registre par défaut) : le texte dit 'read 2026-10-06'", async () => {
    setFinmaVersion("2026.10.06");
    try {
      const res = await companyCheckHandler({ uid: AXA_UID }, { fetch: fetchStub, now }); // pas de deps.finma : registre par défaut
      expect(res.isError).toBeUndefined();
      const fiche = res.structured!;
      expect(fiche.finma.found).toBe(true); // AXA Leben AG figure dans le CSV réel
      expect(fiche.finma.facts.every((f) => f.retrieved_at === "2026-10-06")).toBe(true);
      const text = res.content[0]?.text ?? "";
      expect(text).toContain("read 2026-10-06");
    } finally {
      _resetDataLoaderCache();
    }
  });

  it("fiche avec divergence (nom FINMA différent de LINDAS) : le texte dit 'different', sans mot de verdict", async () => {
    const res = await companyCheckHandler(
      { uid: AXA_UID },
      { fetch: fetchStub, now, finma: () => [finmaRow({ name: "Une Autre Raison Sociale SA" })] },
    );
    expect(res.isError).toBeUndefined();
    const fiche = res.structured!;
    const nameCheck = fiche.cross_checks.find((c) => c.check === "finma_name_vs_lindas_legal_name");
    expect(nameCheck?.result).toBe(false);

    const text = res.content[0]?.text ?? "";
    expect(text).toContain("different");
    assertNoVerdictWords(text);
  });

  it("FINMA illisible (deps.finma qui lève) : la fiche est quand même servie, sans mot de verdict", async () => {
    const throwingFinma = (): never => {
      throw new Error("registre FINMA illisible (test)");
    };
    const res = await companyCheckHandler(
      { uid: AXA_UID },
      { fetch: fetchStub, now, finma: throwingFinma },
    );
    expect(res.isError).toBeUndefined();
    const fiche = res.structured!;
    expect(fiche.finma.available).toBe(false);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("GLEIF");
    expect(text).toContain("LINDAS");
    assertNoVerdictWords(text);
  });
});
