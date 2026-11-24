import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { outOfSpecialtyReason } from "../../scripts/prospect-specialty.js";
import {
  buildMarkdownReport,
  finalizeReport,
  reclassifyOffline,
  type ProspectionCandidate,
  type ProspectionReport,
  type StateEntry,
} from "../../scripts/prospect-sources.js";

// Décision de Claude-Alain du 05.11.2026 : on n'ajoute plus de jeux communaux hors de la spécialité
// (listes officielles à garder en mémoire, douane et commerce extérieur). Les deux lots examinés
// ensuite (19.11 et 24.11.2026) ont été écartés en entier, 61 jeux sur 61. Cette règle reconnaît
// SANS modèle les cas nets, pour qu'ils ne soient plus proposés à l'examen. Dans le doute, le
// candidat reste proposé : mieux vaut un lot de trop qu'un bon jeu perdu.

const here = dirname(fileURLToPath(import.meta.url));

interface LotRow { lot: string; id: string; title: string; editor_level: string; join_keys: string[] }
const LOTS: LotRow[] = JSON.parse(
  readFileSync(join(here, "fixtures", "prospection-lots-novembre-2026.json"), "utf8"),
);

function candidate(overrides: Partial<ProspectionCandidate> = {}): ProspectionCandidate {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Abfallmengen nach Kategorie, Gemeinde und Jahr (seit 2017)",
    publisher: "Canton de Bâle-Campagne",
    editor_level: "canton",
    url: "https://opendata.swiss/dataset/00000000-0000-0000-0000-000000000001",
    licence: "terms_by",
    formats: ["CSV"],
    frequency: null,
    modified: null,
    join_keys: ["commune"],
    a_verifier_ofs: false,
    a_verifier_personnes: "a_verifier",
    deja_collecte: false,
    status_note: null,
    csv_inspected: true,
    ...overrides,
  };
}

describe("outOfSpecialtyReason : clé locale seule chez un éditeur cantonal ou communal", () => {
  it("clé communale seule (en-tête, titre, ou les deux) : hors spécialité", () => {
    expect(outOfSpecialtyReason(candidate({ join_keys: ["commune"] }))).toBe("clé communale seule");
    expect(outOfSpecialtyReason(candidate({ join_keys: ["commune (titre)"] }))).toBe("clé communale seule");
    expect(outOfSpecialtyReason(candidate({ join_keys: ["commune", "commune (titre)"] }))).toBe("clé communale seule");
    expect(outOfSpecialtyReason(candidate({ editor_level: "commune" }))).toBe("clé communale seule");
  });

  it("numéro postal seul, ou commune et numéro postal : hors spécialité, motif distinct", () => {
    expect(outOfSpecialtyReason(candidate({ title: "Ordnungsbussen", join_keys: ["npa"] }))).toBe("clé locale seule");
    expect(outOfSpecialtyReason(candidate({ title: "Postleitzahl", join_keys: ["npa (titre)"] }))).toBe("clé locale seule");
    expect(outOfSpecialtyReason(candidate({ title: "Schulanlagen nach Standort", join_keys: ["commune", "npa"] }))).toBe("clé locale seule");
  });

  it("une autre clé (canton, IDE, NOGA, tarif) à côté : reste proposé", () => {
    for (const other of ["canton", "canton (titre)", "ide", "noga", "tarif"]) {
      expect(outOfSpecialtyReason(candidate({ join_keys: ["commune", other] }))).toBeNull();
    }
    expect(outOfSpecialtyReason(candidate({ join_keys: ["cle_inconnue"] }))).toBeNull();
  });

  it("aucune clé : reste proposé (rien ne prouve que le jeu est local)", () => {
    expect(outOfSpecialtyReason(candidate({ join_keys: [] }))).toBeNull();
  });

  it("éditeur fédéral ou de niveau inconnu : jamais marqué, même avec une clé communale seule", () => {
    expect(outOfSpecialtyReason(candidate({ editor_level: "confederation" }))).toBeNull();
    expect(outOfSpecialtyReason(candidate({ editor_level: "" }))).toBeNull();
    expect(outOfSpecialtyReason(candidate({ editor_level: "other" }))).toBeNull();
  });
});

describe("outOfSpecialtyReason : un mot de la spécialité dans le titre garde le candidat", () => {
  const kept = [
    "Betriebe mit einer Verkaufsbewilligung für Spirituosen nach Standort", // autorisation
    "Baubewilligungen nach Gemeinde und Quartal (seit 2005)", // le mot seul ne dit pas « statistique »
    "Kantonales Gebäude- und Wohnungsregister (kGWR): Wohnungen", // registre
    "Ortschaftenverzeichnis Kanton Thurgau 2026", // répertoire
    "Liste der zugelassenen Betriebe nach Gemeinde", // liste, agrément
    "Liste des établissements autorisés par commune",
    "Sanktionsliste nach Gemeinde",
    "Zollstellen nach Gemeinde", // douane
    "Bureaux de douane par commune",
    "Einfuhr und Ausfuhr nach Gemeinde", // commerce extérieur
    "Exportations par commune",
    "Tarifzonen nach Gemeinde",
    "Entreprises concessionnaires par commune",
    "Répertoire des établissements agréés par commune",
  ];
  for (const title of kept) {
    it(`reste proposé : « ${title} »`, () => {
      expect(outOfSpecialtyReason(candidate({ title }))).toBeNull();
    });
  }

  it("le mot « Liste » d'un scrutin n'est pas une liste officielle : toujours hors spécialité", () => {
    for (const title of [
      "Nationalratswahlen 2023: Unveränderte und veränderte Wahlzettel nach Liste und Gemeinde",
      "Eidgenössische und kantonale Wahlen: Listenergebnisse nach Gemeinde (seit 2003)",
      "Eidgenössische und kantonale Wahlen: Herkunft der Listenstimmen nach Gemeinde (seit 2003)",
    ]) {
      expect(outOfSpecialtyReason(candidate({ title }))).toBe("clé communale seule");
    }
  });
});

describe("outOfSpecialtyReason : rejouée sur les deux lots écartés en entier (19.11 et 24.11.2026)", () => {
  const verdicts = LOTS.map((row) => ({ row, reason: outOfSpecialtyReason(row) }));
  const count = (lot: string, marked: boolean): number =>
    verdicts.filter((v) => v.row.lot === lot && (v.reason !== null) === marked).length;

  it("le jeu d'essai porte bien les 53 et 8 candidats des deux lots", () => {
    expect(LOTS.filter((r) => r.lot === "2026-11-19")).toHaveLength(53);
    expect(LOTS.filter((r) => r.lot === "2026-11-24")).toHaveLength(8);
  });

  it("lot du 19.11 : 37 écartés seuls, 16 restent à examiner", () => {
    expect(count("2026-11-19", true)).toBe(37);
    expect(count("2026-11-19", false)).toBe(16);
  });

  it("lot du 24.11 : 8 écartés seuls, aucun à examiner (aucun travail déposé)", () => {
    expect(count("2026-11-24", true)).toBe(8);
    expect(count("2026-11-24", false)).toBe(0);
  });

  it("les jeux les plus proches du thème restent à examiner (autorisations, registres, entreprises)", () => {
    const stillProposed = new Set(verdicts.filter((v) => v.reason === null).map((v) => v.row.id));
    for (const id of [
      "f75dfef8-0a4b-4abe-9243-08df44ec0e3d", // commerces autorisés à vendre des spiritueux
      "a9e3968e-9080-40aa-bd77-145a961e0f43", // entreprises (clé IDE)
      "5c19af5d-1a6c-44b0-b52e-2e7149f514ea", // transferts de siège (clé IDE)
      "66e08522-428c-41ea-a9bf-282b975275c2", // registre cantonal
      "3f64d037-16d4-4293-95c9-62d106158941", // marchés publics (clé cantonale)
    ]) {
      expect(stillProposed.has(id)).toBe(true);
    }
  });
});

describe("rapport de prospection : chaque candidat publié porte `hors_specialite`", () => {
  const run: ProspectionReport["run"] = {
    pages_read: 1, page_size: 100, max_pages: 55, start_page: 0, total_pages: 1, datasets_read: 3,
    datasets_total_catalog: 3, coverage_ratio: 1, partial: false, stopped_reason: "ok",
  };
  const local = candidate({ id: "a-local" });
  const federal = candidate({ id: "b-federal", editor_level: "confederation", title: "Bureaux de douane", join_keys: ["commune"] });
  const list = candidate({ id: "c-liste", title: "Betriebe mit einer Verkaufsbewilligung für Spirituosen nach Standort", join_keys: ["commune", "npa"] });

  it("finalizeReport marque le jeu local et laisse `null` aux autres, sans changer l'ordre ni le nombre", () => {
    const stateMap = new Map<string, StateEntry>([local, federal, list].map((c) => [c.id, { seen_on: "2026-11-24", status: "candidate" }]));
    const report = finalizeReport({
      stateMap,
      candidatesPool: new Map([local, federal, list].map((c) => [c.id, c])),
      exclusionBlacklist: new Map(),
      alreadyCollected: new Set(),
      generatedOn: "2026-11-24",
      source: "https://ckan.opendata.swiss/api/3/action/package_search",
      run,
    });
    expect(report.candidates.map((c) => [c.id, c.hors_specialite])).toEqual([
      ["b-federal", null],
      ["c-liste", null],
      ["a-local", "clé communale seule"],
    ]);
    expect(report.totals.candidates).toBe(3);
  });

  it("un enregistrement repris d'un ancien rapport (sans le champ, ou avec une valeur périmée) est recalculé", () => {
    const stale = { ...local, hors_specialite: null } as ProspectionCandidate;
    const wrong = { ...federal, hors_specialite: "clé communale seule" } as ProspectionCandidate;
    const report = finalizeReport({
      stateMap: new Map(),
      candidatesPool: new Map([stale, wrong].map((c) => [c.id, c])),
      exclusionBlacklist: new Map(),
      alreadyCollected: new Set(),
      generatedOn: "2026-11-24",
      source: "x",
      run,
    });
    expect(report.candidates.find((c) => c.id === "a-local")?.hors_specialite).toBe("clé communale seule");
    expect(report.candidates.find((c) => c.id === "b-federal")?.hors_specialite).toBeNull();
  });

  it("reclassifyOffline (correctif sans réseau) marque de la même façon", () => {
    const previous: ProspectionReport = {
      generated_on: "2026-11-23", source: "x", run,
      totals: { candidates: 3, excluded: 0, excluded_by_motif: {} },
      candidates: [federal, list, local],
      already_collected: [],
    };
    const stateMap = new Map<string, StateEntry>([local, federal, list].map((c) => [c.id, { seen_on: "2026-11-23", status: "candidate" }]));
    const result = reclassifyOffline(stateMap, previous, [], "2026-11-24");
    expect(result.candidates.map((c) => [c.id, c.hors_specialite])).toEqual([
      ["b-federal", null],
      ["c-liste", null],
      ["a-local", "clé communale seule"],
    ]);
  });

  it("le rapport lisible compte les jeux hors spécialité et le dit dans la colonne « Statut »", () => {
    const report: ProspectionReport = {
      generated_on: "2026-11-24", source: "x", run,
      totals: { candidates: 3, excluded: 0, excluded_by_motif: {} },
      candidates: [
        { ...federal, hors_specialite: null },
        { ...list, hors_specialite: null },
        { ...local, hors_specialite: "clé communale seule" },
      ],
      already_collected: [],
    };
    const md = buildMarkdownReport(report);
    expect(md).toContain("Hors spécialité parmi les 3 candidats gardés : 1 (");
    const row = md.split("\n").find((line) => line.includes("Abfallmengen"));
    expect(row).toContain("| hors spécialité (clé communale seule) |");
    const federalRow = md.split("\n").find((line) => line.includes("Bureaux de douane"));
    expect(federalRow).not.toContain("hors spécialité");
  });
});
