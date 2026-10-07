/**
 * Tests de `scripts/prospect-sources.ts` (tâche osd.prospection, piste A du plan
 * `2026-10-06-prospection-et-api.md`).
 *
 * AUCUN appel réseau : les fonctions pures sont testées directement, et toute fonction d'E/S
 * reçoit un `fetchImpl`/`sleepImpl` injecté (jamais `fetch`/`setTimeout` globaux). Les fixtures
 * `tests/fixtures/prospection/package_show_*.json` sont des réponses RÉELLES de l'API CKAN
 * officielle d'opendata.swiss (`package_show`), enregistrées le 06.10.2026 (moins de 20 appels
 * réels au total pour ce chantier, dont 8 pour ces fixtures) — jamais inventées. Chaque fixture
 * illustre un cas du plan : rues/limites (licence ouverte, candidats), Genève REG (licence
 * ouverte MAIS marqueur « personnes »), typologie des communes de Fribourg (`cc-by-sa`),
 * commune historisée (aucun `rights` dans le JSON), registre des bâtiments (OFS, « à
 * vérifier »), répertoire des localités (déjà au registre du projet → `deja_collecte`).
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CkanPackage,
  type CkanSearchResponse,
  type ProspectionCandidate,
  type ProspectionReport,
  type StateEntry,
  PERSON_MARKERS,
  buildFicheUrl,
  buildMarkdownReport,
  classifyLicence,
  detectIdeColumn,
  exitCodeFor,
  reclassifyOffline,
  rereadForPersonMarkers,
  loadExclusionBlacklist,
  serializeExclusionBlacklist,
  type ExclusionEntry,
  finalizeReport,
  classifyPackage,
  classifyResourceRights,
  collectSearchableText,
  compareCandidates,
  computeStartPage,
  daysBetweenIso,
  detectJoinKeysFromHeader,
  detectPersonColumns,
  detectJoinKeysFromTitle,
  detectPersonMarkers,
  editorLevelRank,
  frequencyRank,
  isAlreadyCollected,
  isCsvResource,
  isOfsPackage,
  isPublishableCandidate,
  orderForPublicDisplay,
  isoWeekNumber,
  loadState,
  pickLocalizedText,
  rotatingPageSequence,
  serializeState,
  splitHeaderColumns,
  prospectSources,
  readCsvHeaderPartial,
  registryTokens,
  toIsoDate,
  tokensFromUrl,
} from "../../scripts/prospect-sources.js";

function loadFixture(name: string): CkanPackage {
  const text = readFileSync(new URL(`../fixtures/prospection/${name}`, import.meta.url), "utf8");
  return JSON.parse(text).result as CkanPackage;
}

const streets = loadFixture("package_show_streets.json");
const limites = loadFixture("package_show_limites.json");
const regGeneve = loadFixture("package_show_reg_geneve.json");
const communesHistorise = loadFixture("package_show_communes_historise.json");
const gemeindetypologie = loadFixture("package_show_gemeindetypologie.json");
// Le vrai jeu GWR n'a aucune ressource CSV et aucune clé de jointure détectable dans son titre
// d'origine : depuis le filtre public du 07.10.2026 (éditeur fédéral/cantonal ET au moins une
// clé de jointure), il ne serait plus publié du tout — ce qui est le comportement VOULU, pas un
// bug. On lui ajoute ici une clé de jointure textuelle factice (« par commune ») pour continuer
// à tester, séparément, que le marqueur OFS traverse bien la publication quand le jeu est
// par ailleurs publiable.
const ofsGwrRaw = loadFixture("package_show_ofs_gwr.json");
const ofsGwr: CkanPackage = {
  ...ofsGwrRaw,
  title: { ...ofsGwrRaw.title, fr: `${ofsGwrRaw.title?.fr ?? ""} par commune` },
};
const localites = loadFixture("package_show_localites.json");

const noOp = async (): Promise<void> => {}; // sleepImpl pour les tests : aucune attente réelle

// Même motif que `tests/scripts/sync-localities.test.ts` : un dossier temporaire jetable par
// test, jamais un chemin fixe sous /tmp (qui romprait des tests lancés en parallèle et
// laisserait des fichiers derrière lui).
const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "osd-prospect-sources-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pickLocalizedText", () => {
  it("préfère le français, puis retombe sur une autre langue non vide", () => {
    expect(pickLocalizedText({ fr: "Rues", de: "Strassen" })).toBe("Rues");
    expect(pickLocalizedText({ fr: "", de: "Strassen", it: "", en: "" })).toBe("Strassen");
    expect(pickLocalizedText("texte simple")).toBe("texte simple");
    expect(pickLocalizedText(undefined)).toBe("");
    expect(pickLocalizedText({ fr: "", de: "", it: "", en: "" })).toBe("");
  });
});

describe("classifyResourceRights — fragment EXACT après #, jamais une sous-chaîne", () => {
  it("reconnaît terms_open et terms_by", () => {
    expect(classifyResourceRights("https://opendata.swiss/terms-of-use#terms_open")).toBe("open");
    expect(classifyResourceRights("https://opendata.swiss/terms-of-use#terms_by")).toBe("by");
  });
  it("NE confond JAMAIS terms_by avec terms_by_ask (le bug à ne pas réintroduire)", () => {
    expect(classifyResourceRights("https://opendata.swiss/terms-of-use#terms_by_ask")).toBe("by_ask");
    expect(classifyResourceRights("https://opendata.swiss/terms-of-use#terms_ask")).toBe("ask");
  });
  it("reconnaît cc-by-sa (vocabulaire distinct opendefinition.org) et l'absence de rights", () => {
    expect(classifyResourceRights("http://www.opendefinition.org/licenses/cc-by-sa")).toBe("cc_by_sa");
    expect(classifyResourceRights(null)).toBe("absente");
    expect(classifyResourceRights(undefined)).toBe("absente");
    expect(classifyResourceRights("")).toBe("absente");
  });
  // Décision de l'intégrateur du 07.10.2026 : CC0 (toute version) → "public_domain" ; CC-BY PUR
  // (sans SA ni NC, toute version) → "attribution" ; CC-BY-SA reste "cc_by_sa" (inchangé) ; toute
  // licence NC (seule ou combinée) ou ND reste "autre", jamais reconnue comme ouverte.
  it("reconnaît CC0 (creativecommons.org, toute version) comme public_domain", () => {
    expect(classifyResourceRights("https://creativecommons.org/publicdomain/zero/1.0/")).toBe("public_domain");
    expect(classifyResourceRights("http://creativecommons.org/publicdomain/zero/1.0/deed.fr")).toBe("public_domain");
  });
  it("reconnaît CC-BY pur (creativecommons.org, versions 3.0 et 4.0) comme attribution", () => {
    expect(classifyResourceRights("https://creativecommons.org/licenses/by/4.0/")).toBe("attribution");
    expect(classifyResourceRights("https://creativecommons.org/licenses/by/3.0/ch/")).toBe("attribution");
  });
  it("NE reconnaît JAMAIS une licence CC avec NC ou ND comme ouverte (motif : jamais affirmé ouvert par excès de confiance)", () => {
    expect(classifyResourceRights("https://creativecommons.org/licenses/by-nc/4.0/")).toBe("autre");
    expect(classifyResourceRights("https://creativecommons.org/licenses/by-nc-sa/4.0/")).toBe("autre");
    expect(classifyResourceRights("https://creativecommons.org/licenses/by-nc-nd/4.0/")).toBe("autre");
    expect(classifyResourceRights("https://creativecommons.org/licenses/by-nd/4.0/")).toBe("autre");
  });
  it("CC-BY-SA via creativecommons.org (pas seulement opendefinition.org) reste cc_by_sa, jamais confondu avec attribution", () => {
    expect(classifyResourceRights("https://creativecommons.org/licenses/by-sa/4.0/")).toBe("cc_by_sa");
  });
  it("cc-by-4.0 sur opendefinition.org (numéro de version collé au code, sans séparateur) → attribution, pas autre (régression du 07.10.2026)", () => {
    expect(classifyResourceRights("http://www.opendefinition.org/licenses/cc-by-4.0")).toBe("attribution");
  });
});

describe("classifyLicence — sur les fixtures réelles", () => {
  it("rues (swisstopo) : terms_open → open", () => {
    expect(classifyLicence(streets.resources).licence).toBe("open");
  });
  it("limites administratives (swisstopo) : terms_open → open", () => {
    expect(classifyLicence(limites.resources).licence).toBe("open");
  });
  it("typologie des communes (Fribourg) : cc-by-sa seul → exclu, motif licence_cc_by_sa", () => {
    const v = classifyLicence(gemeindetypologie.resources);
    expect(v.licence).toBe("exclu");
    expect(v.motif).toBe("licence_cc_by_sa");
  });
  it("liste historisée des communes (OFS) : aucun rights → exclu, motif licence_absente", () => {
    const v = classifyLicence(communesHistorise.resources);
    expect(v.licence).toBe("exclu");
    expect(v.motif).toBe("licence_absente");
  });
  it("registre des bâtiments OFS : terms_open → open (l'exclusion OFS est un flag séparé, pas une licence)", () => {
    expect(classifyLicence(ofsGwr.resources).licence).toBe("open");
  });
  // Décision de l'intégrateur du 07.10.2026 : renommage licence_fermee → licence_non_ouverte,
  // et acceptation de CC0/CC-BY purs comme licences ouvertes à part entière.
  it("CC0 pur → open, matched=public_domain", () => {
    const v = classifyLicence([{ rights: "https://creativecommons.org/publicdomain/zero/1.0/" }]);
    expect(v).toEqual({ licence: "open", matched: "public_domain" });
  });
  it("CC-BY pur → open, matched=attribution", () => {
    const v = classifyLicence([{ rights: "https://creativecommons.org/licenses/by/4.0/" }]);
    expect(v).toEqual({ licence: "open", matched: "attribution" });
  });
  it("CC-BY-NC → exclu, motif licence_non_ouverte (jamais licence_cc_by_sa ni une forme ouverte)", () => {
    const v = classifyLicence([{ rights: "https://creativecommons.org/licenses/by-nc/4.0/" }]);
    expect(v.licence).toBe("exclu");
    expect(v.motif).toBe("licence_non_ouverte");
  });
  it("terms_ask (vocabulaire opendata.swiss) → exclu, motif licence_non_ouverte (ex-licence_fermee)", () => {
    const v = classifyLicence([{ rights: "https://opendata.swiss/terms-of-use#terms_ask" }]);
    expect(v.licence).toBe("exclu");
    expect(v.motif).toBe("licence_non_ouverte");
  });
});

describe("detectPersonMarkers — liste fermée, sans faux positif sur les référentiels géographiques", () => {
  it("ne détecte AUCUN marqueur sur rues, limites, localités ou le registre des bâtiments", () => {
    for (const pkg of [streets, limites, localites, ofsGwr]) {
      expect(detectPersonMarkers(collectSearchableText(pkg)), pkg.name).toEqual([]);
    }
  });
  it("détecte le Répertoire des entreprises de Genève (marqueur « répertoire des entreprises »)", () => {
    const found = detectPersonMarkers(collectSearchableText(regGeneve));
    expect(found).toContain("répertoire des entreprises");
  });
  it("ne détecte rien sur un texte générique mentionnant seulement des noms de lieux (régression du bug « nom »/« names » nus)", () => {
    const text = "Nom de la localité, nom de rue, street names, locality names, nome del comune, place names";
    expect(detectPersonMarkers(text)).toEqual([]);
  });
  it("détecte bien un prénom/nom de famille explicite", () => {
    expect(detectPersonMarkers("Liste avec prénom, nom de famille et titulaire")).toEqual(
      expect.arrayContaining(["prénom", "nom de famille", "titulaire"]),
    );
    expect(detectPersonMarkers("Vorname und Nachname der Mitglieder")).toEqual(
      expect.arrayContaining(["vorname", "nachname", "mitglieder"]),
    );
  });
  it("tous les marqueurs de la liste fermée se détectent eux-mêmes (aucun motif cassé)", () => {
    for (const marker of PERSON_MARKERS) {
      expect(detectPersonMarkers(`texte ${marker} texte`), marker).toContain(marker);
    }
  });
  // Relecture Focus 1 du 07.10.2026 (point 1b) : marqueurs-préfixes, flexions, diacritiques.
  it("détecte les flexions des marqueurs-préfixes (Ratsmitglieder, Mitgliedschaft, députés, Abgeordnete, Grossrätin, Kontaktpersonen)", () => {
    expect(detectPersonMarkers("Liste der Ratsmitglieder")).toContain("ratsmitglieder");
    expect(detectPersonMarkers("Bedingungen der Mitgliedschaft")).toContain("mitglied");
    expect(detectPersonMarkers("Participation des députés")).toContain("depute");
    expect(detectPersonMarkers("Verzeichnis der Abgeordneten")).toContain("abgeordnete");
    expect(detectPersonMarkers("Liste der Grossrätin und Grossräte")).toContain("grossrat");
    expect(detectPersonMarkers("Liste der Kontaktpersonen")).toContain("kontaktperson");
  });
  it("NE détecte PAS « Personenverkehr » (transport de voyageurs) — portée limitée aux nouveaux marqueurs-préfixes", () => {
    expect(detectPersonMarkers("Statistik des Personenverkehrs")).toEqual([]);
  });
});

describe("isCsvResource — un CSV emballé dans un ZIP n'est jamais une lecture partielle valable", () => {
  it("écarte un CSV réel du Répertoire des entreprises de Genève (format CSV, URL en .zip)", () => {
    const csvZip = regGeneve.resources?.find((r) => r.format === "CSV");
    expect(csvZip?.url).toMatch(/\.zip$/i);
    expect(isCsvResource(csvZip!)).toBe(false);
  });
  it("accepte un vrai CSV non emballé", () => {
    expect(isCsvResource({ format: "CSV", url: "https://example.test/data.csv" })).toBe(true);
    expect(isCsvResource({ url: "https://example.test/data.csv?x=1" })).toBe(true);
  });
});

describe("isOfsPackage", () => {
  it("vrai pour l'OFS (organisation ou URL bfs.admin.ch)", () => {
    expect(isOfsPackage(ofsGwr)).toBe(true);
    expect(isOfsPackage(communesHistorise)).toBe(true);
  });
  it("faux pour swisstopo", () => {
    expect(isOfsPackage(streets)).toBe(false);
    expect(isOfsPackage(limites)).toBe(false);
  });
});

describe("detectJoinKeysFromHeader", () => {
  it("détecte NPA, commune et canton dans un en-tête officiel suisse (point-virgule)", () => {
    expect(detectJoinKeysFromHeader("Ortschaftsname;PLZ4;Zusatzziffer;Gemeindename;BFS-Nr;Kantonskürzel")).toEqual([
      "canton", "commune", "npa",
    ]);
  });
  it("détecte IDE (UID/CHE) dans un en-tête à virgules", () => {
    expect(detectJoinKeysFromHeader("Nom,UID,Adresse,CHE")).toEqual(["ide"]);
  });
  it("détecte NOGA et le numéro tarifaire", () => {
    expect(detectJoinKeysFromHeader("Code_NOGA;Libelle")).toEqual(["noga"]);
    expect(detectJoinKeysFromHeader("numero_tarifaire;designation")).toEqual(["tarif"]);
  });
  it("ne détecte rien sur un en-tête sans motif connu", () => {
    expect(detectJoinKeysFromHeader("Colonne1,Colonne2,Valeur")).toEqual([]);
  });
  // Relecture Focus 1 du 07.10.2026 (point 5) : « ide » seulement sur une liste FERMÉE de noms
  // EXACTS après normalisation — jamais un `*_uid` quelconque (bug réel : les 12 jeux du Grand
  // Conseil bernois avaient `votum_mitglied`/`mitglied_uid`, un identifiant de PERSONNE, matchés
  // à tort comme une clé « ide » d'entreprise par l'ancien motif `(uid|ide|che)` sans frontière
  // de droite stricte sur `_`).
  it("JAMAIS un *_uid quelconque pour la clé ide (bug réel du Grand Conseil bernois)", () => {
    expect(detectJoinKeysFromHeader("session_id;votum_mitglied;mitglied_uid;datum")).toEqual([]);
    expect(detectJoinKeysFromHeader("nom;mitglied_uid")).toEqual([]);
  });
  it("reconnaît la liste fermée ide (uid, ide, idi, che, uid_nr, unternehmens_id, numero_ide), toujours en colonne EXACTE", () => {
    for (const col of ["uid", "ide", "idi", "che", "uid_nr", "uidnr", "unternehmens_id", "numero_ide"]) {
      expect(detectJoinKeysFromHeader(`nom;${col};adresse`), col).toEqual(["ide"]);
    }
  });
});

describe("detectPersonColumns — décision du 07.10.2026, sur l'en-tête RÉEL du jeu RPC de l'OFEN", () => {
  // Fixture réelle : tests/fixtures/prospection/ofen-kev-header.csv, capturée le 06.10.2026
  // par lecture partielle (Range) de https://www.uvek-gis.admin.ch/BFE/ogd/6/ogd6_kev-bezueger.csv
  // — le jeu qui a motivé cette décision (classé candidat rang 1 par un run réel, titre et
  // description sans aucun marqueur de personnes, mais en-tête nommant le propriétaire).
  function realOfenKevColumns(): string[] {
    const raw = readFileSync(new URL("../fixtures/prospection/ofen-kev-header.csv", import.meta.url), "utf8");
    return splitHeaderColumns(raw.replace(/^﻿/, "").trim());
  }

  it("détecte produzent_name ET produzent_vorname sur l'en-tête réel (paire de même préfixe)", () => {
    const found = detectPersonColumns(realOfenKevColumns());
    expect(found).toEqual(expect.arrayContaining(["produzent_name", "produzent_vorname"]));
  });
  it("ne détecte PAS les colonnes non personnelles du même en-tête (anlage_*, produzent_firma, produzent_anrede)", () => {
    const found = detectPersonColumns(realOfenKevColumns());
    for (const col of ["anlage_plz", "anlage_kanton", "anlage_strasse", "produzent_firma", "produzent_anrede", "leistung_kw", "jahr"]) {
      expect(found, col).not.toContain(col);
    }
  });
  it("« name »/« nom » seuls ne suffisent jamais (raison sociale)", () => {
    expect(detectPersonColumns(["name", "nom", "Gemeindename", "Ortschaftsname", "raison_sociale"])).toEqual([]);
  });
  it("correspondance exacte (après normalisation _/-/espaces) : Vorname, nachname, prénom, firstname...", () => {
    for (const col of ["Vorname", "nach_name", "prénom", "prenom", "first name", "LASTNAME", "cognome", "surname", "givenname"]) {
      expect(detectPersonColumns([col, "autre_colonne"]), col).toContain(col);
    }
  });
  it("sous-chaîne pour les six motifs les plus sûrs (ex. produzent_vorname, titulaire_prenom)", () => {
    expect(detectPersonColumns(["produzent_vorname"])).toEqual(["produzent_vorname"]);
    expect(detectPersonColumns(["titulaire_prenom"])).toEqual(["titulaire_prenom"]);
  });
  it("une colonne *_name sans sœur *_vorname du même préfixe n'est PAS détectée seule", () => {
    expect(detectPersonColumns(["produzent_name", "produzent_firma"])).toEqual([]);
  });

  // Affinage du 07.10.2026 (sans laxisme) : ces formes agrégées/institutionnelles ne déclenchent
  // JAMAIS les motifs génériques « person »/« mitglied »/« member »…
  it("NE détecte PAS les formes agrégées ou institutionnelles sûres (comptes de personnes, États membres, véhicules)", () => {
    expect(detectPersonColumns(["Personenwagen", "anzahl_personen", "personen_anzahl", "nombre_personnes", "n_personen"])).toEqual([]);
    expect(detectPersonColumns(["Personenkilometer"])).toEqual([]);
    expect(detectPersonColumns(["Mitgliedstaat", "mitgliedstaaten", "etats_membres", "member_state"])).toEqual([]);
  });
  it("une forme sûre n'affaiblit JAMAIS un motif SPÉCIFIQUE toujours dangereux (email, Kontaktperson, votum_mitglied)", () => {
    expect(detectPersonColumns(["Kontaktperson"])).toEqual(["Kontaktperson"]);
    expect(detectPersonColumns(["votum_mitglied"])).toEqual(["votum_mitglied"]);
    expect(detectPersonColumns(["Email"])).toEqual(["Email"]);
  });
  // Relecture finale du 07.10.2026 (dernière prudence) : des RÔLES qui désignent une personne
  // précise — un annuaire d'associations ou d'entreprises nomme presque toujours son·sa
  // titulaire par ce rôle, même sans colonne nom/prénom séparée.
  it("détecte les rôles qui désignent une personne (président, responsable d'un annuaire, etc.)", () => {
    for (const col of [
      "Praesident", "Präsident", "President", "Presidente",
      "Leiter", "Leiterin", "Leitung_Name",
      "Inhaber", "Inhaberin", "Verantwortlich", "Ansprechpartner", "Ansprechperson",
      "Responsable", "Referent", "Kontaktname",
    ]) {
      expect(detectPersonColumns([col]), col).toEqual([col]);
    }
  });
  // Relevé le 07.10.2026 : les formes de COMPTE ne sont sûres qu'en colonne EXACTE — en
  // sous-chaîne, « n_personen » aurait aussi exempté ces colonnes qui NOMMENT un responsable.
  it("les formes de compte (anzahl_personen…) ne sont sûres qu'EXACTES : une colonne qui les contient en plus d'autre chose reste détectée", () => {
    expect(detectPersonColumns(["zustaendigen_personen"])).toEqual(["zustaendigen_personen"]);
    expect(detectPersonColumns(["verantwortlichen_personen"])).toEqual(["verantwortlichen_personen"]);
  });

  // Relecture Focus 1 du 07.10.2026 (relecture REFUSÉE une première fois) : deux en-têtes RÉELS
  // manqués par la liste d'avant — OFEN « Pinch » et le Grand Conseil bernois.
  it("en-tête RÉEL OFEN « Pinch » : Kontaktperson, Telefon et Email sont détectés", () => {
    const header = "Firma;Strassenname;Hausnummer;Ortschaft;PLZ;Website;Kontaktperson;Telefon;Email;Lon;Lat";
    const found = detectPersonColumns(splitHeaderColumns(header));
    expect(found).toEqual(expect.arrayContaining(["Kontaktperson", "Telefon", "Email"]));
  });
  it("en-tête RÉEL du Grand Conseil bernois : votum_mitglied et mitglied_uid sont détectés", () => {
    const found = detectPersonColumns(["session_id", "votum_mitglied", "mitglied_uid", "datum"]);
    expect(found).toEqual(expect.arrayContaining(["votum_mitglied", "mitglied_uid"]));
  });
});

describe("detectJoinKeysFromTitle — élargi aux référentiels géographiques exposés en API/WMS", () => {
  it("répertoire des rues → commune (titre)", () => {
    expect(detectJoinKeysFromTitle(streets.title)).toEqual(["commune (titre)"]);
  });
  it("limites administratives → commune ET canton (titre)", () => {
    expect(detectJoinKeysFromTitle(limites.title)).toEqual(["canton (titre)", "commune (titre)"]);
  });
  it("répertoire des localités (code postal) → npa (titre)", () => {
    expect(detectJoinKeysFromTitle(localites.title)).toEqual(["npa (titre)"]);
  });
  it("phrase explicite « par commune »/« nach Gemeinde »", () => {
    expect(detectJoinKeysFromTitle({ fr: "Bâtiments par commune" })).toEqual(["commune (titre)"]);
    expect(detectJoinKeysFromTitle({ de: "Gebäude nach Gemeinde" })).toEqual(["commune (titre)"]);
  });
  it("aucun motif → liste vide", () => {
    expect(detectJoinKeysFromTitle(regGeneve.title)).toEqual([]);
  });
});

describe("editorLevelRank / frequencyRank / compareCandidates — tri déterministe, sans score", () => {
  it("fédéral avant cantonal avant communal avant inconnu", () => {
    expect(editorLevelRank("confederation")).toBeLessThan(editorLevelRank("canton"));
    expect(editorLevelRank("canton")).toBeLessThan(editorLevelRank("commune"));
    expect(editorLevelRank("commune")).toBeLessThan(editorLevelRank(undefined));
  });
  it("une fréquence connue est mieux classée qu'une fréquence inconnue", () => {
    expect(frequencyRank("http://publications.europa.eu/resource/authority/frequency/DAILY")).toBeLessThan(frequencyRank(null));
    expect(frequencyRank("http://publications.europa.eu/resource/authority/frequency/IRREG")).toBeLessThan(frequencyRank(null));
  });
  function candidate(partial: Partial<ProspectionCandidate>): ProspectionCandidate {
    return {
      id: "x", title: "x", publisher: "x", editor_level: "confederation", url: "https://x",
      licence: "terms_open", formats: [], frequency: null, modified: null, join_keys: [],
      a_verifier_ofs: false, a_verifier_personnes: "a_verifier", deja_collecte: false,
      status_note: null,
      ...partial,
    };
  }
  it("trie par niveau d'éditeur d'abord", () => {
    const commune = candidate({ id: "b", editor_level: "commune" });
    const federal = candidate({ id: "a", editor_level: "confederation" });
    expect([commune, federal].sort(compareCandidates)).toEqual([federal, commune]);
  });
  it("à niveau d'éditeur égal, plus de clés de jointure gagne", () => {
    const peu = candidate({ id: "b", join_keys: ["npa"] });
    const beaucoup = candidate({ id: "a", join_keys: ["npa", "commune", "canton"] });
    expect([peu, beaucoup].sort(compareCandidates)).toEqual([beaucoup, peu]);
  });
  it("à égalité totale, départage par identifiant (déterminisme)", () => {
    const b = candidate({ id: "b" });
    const a = candidate({ id: "a" });
    expect([b, a].sort(compareCandidates)).toEqual([a, b]);
  });
});

describe("isPublishableCandidate / orderForPublicDisplay — filtre public et ordre OFS-après (décision du 07.10.2026)", () => {
  function candidate(partial: Partial<ProspectionCandidate>): ProspectionCandidate {
    return {
      id: "x", title: "x", publisher: "x", editor_level: "confederation", url: "https://x",
      licence: "terms_open", formats: [], frequency: null, modified: null, join_keys: ["commune (titre)"],
      a_verifier_ofs: false, a_verifier_personnes: "a_verifier", deja_collecte: false, status_note: null,
      csv_inspected: true,
      ...partial,
    };
  }
  it("exige un éditeur fédéral ou cantonal, au moins une clé de jointure, ET un en-tête CSV inspecté avec succès", () => {
    expect(isPublishableCandidate(candidate({ csv_inspected: false }))).toBe(false);
  });
  it("exige un éditeur fédéral ou cantonal ET au moins une clé de jointure", () => {
    expect(isPublishableCandidate(candidate({ editor_level: "confederation", join_keys: ["npa"] }))).toBe(true);
    expect(isPublishableCandidate(candidate({ editor_level: "canton", join_keys: ["canton"] }))).toBe(true);
    expect(isPublishableCandidate(candidate({ editor_level: "commune", join_keys: ["npa"] }))).toBe(false);
    expect(isPublishableCandidate(candidate({ editor_level: "confederation", join_keys: [] }))).toBe(false);
  });
  it("un jeu OFS (a_verifier_ofs) reste publiable s'il remplit par ailleurs le filtre — jamais exclu pour ce seul motif", () => {
    expect(isPublishableCandidate(candidate({ a_verifier_ofs: true }))).toBe(true);
  });
  it("ordonne tous les non-OFS avant tous les OFS, chaque groupe trié par compareCandidates", () => {
    const ofsA = candidate({ id: "ofs-a", a_verifier_ofs: true });
    const nonOfsZ = candidate({ id: "non-ofs-z", editor_level: "canton" }); // rang moins bon que confederation
    const nonOfsA = candidate({ id: "non-ofs-a" });
    const ordered = orderForPublicDisplay([ofsA, nonOfsZ, nonOfsA]);
    expect(ordered.map((c) => c.id)).toEqual(["non-ofs-a", "non-ofs-z", "ofs-a"]);
  });
});

describe("tokensFromUrl / isAlreadyCollected — déjà collecté, sans faux positif générique", () => {
  it("ignore les segments génériques d'API même longs (collections, classifications…)", () => {
    const tokens = tokensFromUrl("https://data.geo.admin.ch/api/stac/v0.9/collections/items");
    expect(tokens).not.toContain("collections");
  });
  it("conserve un segment distinctif réel (identifiant STAC swisstopo)", () => {
    const tokens = tokensFromUrl(
      "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo-vd.ortschaftenverzeichnis_plz/items",
    );
    expect(tokens).toContain("ortschaftenverzeichnis_plz");
  });
  it("ignore la chaîne de requête (jamais de faux positif venu d'un paramètre SPARQL)", () => {
    const tokens = tokensFromUrl("https://publications.europa.eu/webapi/rdf/sparql?query=TRESLONGUEREQUETEENCODEE");
    expect(tokens.join(" ")).not.toContain("treslonguerequeteencodee");
  });
  it("le répertoire des localités (déjà au registre) est marqué deja_collecte", () => {
    expect(isAlreadyCollected(localites, registryTokens())).toBe(true);
  });
  it("le répertoire des rues est maintenant marqué deja_collecte (piste B l'a ajouté au registre entre-temps)", () => {
    expect(isAlreadyCollected(streets, registryTokens())).toBe(true);
  });
  it("les limites administratives (absentes du registre) ne sont PAS marquées deja_collecte", () => {
    expect(isAlreadyCollected(limites, registryTokens())).toBe(false);
  });
});

describe("classifyPackage — verdict complet sur chaque fixture réelle", () => {
  const tokens = registryTokens();

  it("rues : candidat, pas OFS, déjà collecté (piste B l'a ajouté au registre entre-temps)", () => {
    const v = classifyPackage(streets, tokens);
    expect(v.isCandidate).toBe(true);
    expect(v.ofsFlag).toBe(false);
    expect(v.dejaCollecte).toBe(true);
  });
  it("limites administratives : candidat, fédéral", () => {
    const v = classifyPackage(limites, tokens);
    expect(v.isCandidate).toBe(true);
    expect(v.editorLevel).toBe("confederation");
  });
  it("localités : candidat ET déjà collecté", () => {
    const v = classifyPackage(localites, tokens);
    expect(v.isCandidate).toBe(true);
    expect(v.dejaCollecte).toBe(true);
  });
  it("registre des bâtiments OFS : candidat MAIS a_verifier_ofs", () => {
    const v = classifyPackage(ofsGwr, tokens);
    expect(v.isCandidate).toBe(true);
    expect(v.ofsFlag).toBe(true);
  });
  it("typologie des communes (cc-by-sa) : jamais candidat (Review Focus 1)", () => {
    const v = classifyPackage(gemeindetypologie, tokens);
    expect(v.isCandidate).toBe(false);
    expect(v.exclusionMotif).toBe("licence_cc_by_sa");
  });
  it("liste historisée des communes (sans rights) : jamais candidat", () => {
    const v = classifyPackage(communesHistorise, tokens);
    expect(v.isCandidate).toBe(false);
    expect(v.exclusionMotif).toBe("licence_absente");
  });
  it("Répertoire des entreprises de Genève : licence ouverte MAIS jamais candidat (personnes)", () => {
    const v = classifyPackage(regGeneve, tokens);
    expect(v.isCandidate).toBe(false);
    expect(v.exclusionMotif).toBe("personnes_detectees");
    expect(v.personMarkers.length).toBeGreaterThan(0);
  });
});

describe("readCsvHeaderPartial", () => {
  it("renvoie la première ligne quand le serveur répond 200/206", async () => {
    const fetchImpl = (async () =>
      new Response("PLZ4;Ortschaftsname;BFS-Nr\n1204;Genève;6621\n", { status: 206 })) as unknown as typeof fetch;
    const line = await readCsvHeaderPartial(fetchImpl, "https://example.test/x.csv", "UA", 1000);
    expect(line).toBe("PLZ4;Ortschaftsname;BFS-Nr");
  });
  it("ignore un Range refusé (ex. 416) sans lever d'erreur", async () => {
    const fetchImpl = (async () => new Response("", { status: 416 })) as unknown as typeof fetch;
    const line = await readCsvHeaderPartial(fetchImpl, "https://example.test/x.csv", "UA", 1000);
    expect(line).toBeNull();
  });
  it("ignore une erreur réseau sans lever d'erreur", async () => {
    const fetchImpl = (async () => { throw new Error("réseau coupé"); }) as unknown as typeof fetch;
    const line = await readCsvHeaderPartial(fetchImpl, "https://example.test/x.csv", "UA", 1000);
    expect(line).toBeNull();
  });
  it("coupe un flux qui continue d'envoyer des données après l'en-tête (serveur ignorant Range — incident réel du 06.10.2026)", async () => {
    let pullCount = 0;
    let cancelled = false;
    const header = "PLZ4;Ortschaftsname\n";
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount++;
        if (pullCount === 1) {
          controller.enqueue(new TextEncoder().encode(header));
        } else {
          // Un serveur qui ignore `Range` répondrait 200 avec le fichier ENTIER : sans
          // annulation côté client, ce flux continuerait indéfiniment.
          controller.enqueue(new TextEncoder().encode("x".repeat(1000)));
        }
      },
      cancel() { cancelled = true; },
    });
    const fetchImpl = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch;
    const line = await readCsvHeaderPartial(fetchImpl, "https://example.test/big.csv", "UA", 5000);
    expect(line).toBe("PLZ4;Ortschaftsname");
    expect(cancelled).toBe(true);
    expect(pullCount).toBeLessThan(10); // borné : jamais tout le flux parcouru
  });

  it("coupe correctement un CSV dont les lignes finissent par \\r SEUL (incident réel du 07.10.2026, Musée national suisse)", async () => {
    // Avant ce correctif, l'absence de \n faisait tout avaler comme « en-tête » (jusqu'à 64 Ko) —
    // ni "OBJEKT ID" ni "OBJEKT Inventarnummer" (l'en-tête réel du Musée national suisse) ne
    // contiennent "canton"/"commune"/"ide" : seule une donnée polluait la détection.
    const body = 'OBJEKT ID;OBJEKT Inventarnummer\r"1";"Kanton Zürich, ville fictive"\r"2";"Autre ligne"';
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const line = await readCsvHeaderPartial(fetchImpl, "https://example.test/mac-classic.csv", "UA", 5000);
    expect(line).toBe("OBJEKT ID;OBJEKT Inventarnummer");
    // Preuve directe que la pollution de clé est corrigée : "Kanton Zürich" (une donnée, pas un
    // nom de colonne) ne doit plus faire croire à une clé "canton" détectée sur CET en-tête.
    expect(detectJoinKeysFromHeader(line!)).toEqual([]);
  });

  it("redécode en Latin-1 si l'UTF-8 produit des caractères de remplacement (incident réel : accents perdus)", async () => {
    // "Prénom" encodé en Latin-1 (0xE9 pour é) est invalide en UTF-8 → décodage naïf = "Pr�nom",
    // qui ne matcherait NI "prénom" NI "prenom". Octets bruts : "Nom;Pr" + 0xE9 + "nom\n".
    const latin1Bytes = Buffer.concat([
      Buffer.from("Nom;Pr", "latin1"),
      Buffer.from([0xe9]),
      Buffer.from("nom\n", "latin1"),
    ]);
    const fetchImpl = (async () => new Response(latin1Bytes, { status: 200 })) as unknown as typeof fetch;
    const line = await readCsvHeaderPartial(fetchImpl, "https://example.test/latin1.csv", "UA", 5000);
    expect(line).toBe("Nom;Prénom");
    expect(detectPersonColumns(splitHeaderColumns(line!))).toEqual(["Prénom"]);
  });

  it("un en-tête UTF-8 valide n'est PAS basculé en Latin-1 par un caractère multi-octets tronqué PLUS LOIN dans le buffer (relecture du 07.10.2026)", async () => {
    // Un `Range` coupe à un octet précis : un caractère UTF-8 multi-octets (ex. é = 0xC3 0xA9)
    // peut être tronqué net à la limite, rendant TOUT le buffer invalide en UTF-8 si on le
    // décode entièrement avant de couper — y compris un en-tête parfaitement valide qui le
    // précède. La coupure de ligne doit se faire au niveau des OCTETS, avant tout décodage.
    const truncatedChar = Buffer.from("é", "utf8").subarray(0, 1); // 0xC3 seul : invalide, tronqué
    const body = Buffer.concat([
      Buffer.from("Nom;Prénom\n", "utf8"), // en-tête valide, avec un accent réel
      Buffer.from("x"), truncatedChar, // reste du buffer, hors de la ligne d'en-tête
    ]);
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const line = await readCsvHeaderPartial(fetchImpl, "https://example.test/truncated.csv", "UA", 5000);
    expect(line).toBe("Nom;Prénom"); // pas "PrÃ©nom" ni un en-tête basculé en Latin-1 à tort
    expect(detectPersonColumns(splitHeaderColumns(line!))).toEqual(["Prénom"]);
  });
});

// ---------------------------------------------------------------------------------------
// Orchestrateur complet : pagination, retentative, rapport partiel, déterminisme.
// ---------------------------------------------------------------------------------------
function makeSearchResponse(count: number, results: CkanPackage[]): Response {
  const body: CkanSearchResponse = { success: true, result: { count, results } };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

// Ajouté le 07.10.2026 (relecture Focus 1, point 3) : `csv_inspected` exige une lecture
// d'en-tête RÉUSSIE pour qu'un candidat soit publiable. Aucune de ces fixtures réelles n'a de
// ressource CSV (toutes API/WMS/SERVICE/XLS/ZIP) — sans cet ajout, aucune ne serait plus jamais
// publiable. Copies locales (jamais les constantes `streets`/`limites`/… elles-mêmes, utilisées
// ailleurs pour vérifier leurs ressources D'ORIGINE, ex. `classifyPackage` sur chaque fixture).
function withCsvResource(pkg: CkanPackage): CkanPackage {
  return { ...pkg, resources: [...(pkg.resources ?? []), { url: `https://example.test/csv/${pkg.id}.csv`, format: "CSV" }] };
}
const ALL_FIXTURES = [streets, limites, regGeneve, communesHistorise, gemeindetypologie, ofsGwr, localites].map(withCsvResource);

describe("prospectSources — orchestrateur (pages simulées, aucun réseau réel)", () => {
  function fixtureFetch(): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/csv/")) return new Response("Colonne1;Colonne2\n", { status: 200 });
      if (url.includes("package_search")) {
        return makeSearchResponse(ALL_FIXTURES.length, ALL_FIXTURES);
      }
      throw new Error(`appel réseau inattendu dans un test : ${url}`);
    }) as unknown as typeof fetch;
  }

  async function run(nowMs: number) {
    const dir = tmpDir();
    const { report } = await prospectSources({
      fetchImpl: fixtureFetch(),
      sleepImpl: noOp,
      maxPages: 1,
      pageSize: ALL_FIXTURES.length,
      outJsonPath: join(dir, "prospection.json"),
      outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"),
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => nowMs,
    });
    return report;
  }

  it("lit tous les jeux de la page, classe correctement candidats et écartés", async () => {
    const report = await run(Date.UTC(2026, 9, 6));
    expect(report.run.datasets_read).toBe(ALL_FIXTURES.length);
    expect(report.run.partial).toBe(false);
    const ids = report.candidates.map((c) => c.id);
    expect(ids).toContain(streets.id);
    expect(ids).toContain(limites.id);
    expect(ids).toContain(localites.id);
    expect(ids).toContain(ofsGwr.id);
    expect(ids).not.toContain(regGeneve.id);
    expect(ids).not.toContain(gemeindetypologie.id);
    expect(ids).not.toContain(communesHistorise.id);
    expect(report.totals.excluded_by_motif.personnes_detectees).toBe(1);
    expect(report.totals.excluded_by_motif.licence_cc_by_sa).toBe(1);
    expect(report.totals.excluded_by_motif.licence_absente).toBe(1);
  });

  it("une candidate venant de l'OFS reste marquée a_verifier_ofs dans le rapport", async () => {
    const report = await run(Date.UTC(2026, 9, 6));
    const gwr = report.candidates.find((c) => c.id === ofsGwr.id);
    expect(gwr?.a_verifier_ofs).toBe(true);
  });

  // Décision de l'intégrateur du 07.10.2026 : un candidat OFS reste montré, jamais caché, mais
  // toujours APRÈS les candidats non-OFS, avec la mention « droits à confirmer (OFS) ».
  it("place le candidat OFS après tous les candidats non-OFS, avec status_note renseigné (les autres : null)", async () => {
    const report = await run(Date.UTC(2026, 9, 6));
    const nonOfsIds = [streets.id, limites.id, localites.id];
    const positions = report.candidates.map((c) => c.id);
    const lastNonOfsIndex = Math.max(...nonOfsIds.map((id) => positions.indexOf(id)));
    const ofsIndex = positions.indexOf(ofsGwr.id);
    expect(ofsIndex).toBeGreaterThan(lastNonOfsIndex);
    const gwr = report.candidates.find((c) => c.id === ofsGwr.id);
    expect(gwr?.status_note).toBe("droits à confirmer (OFS)");
    for (const id of nonOfsIds) {
      expect(report.candidates.find((c) => c.id === id)?.status_note).toBeNull();
    }
  });

  // Décision de l'intégrateur du 07.10.2026 : AUCUN nom de personne ni slug dans le dépôt public —
  // seul l'identifiant technique CKAN (UUID) est écrit, jamais `pkg.name` (le slug), qu'il soit
  // encodé ou en clair, ni dans l'état ni dans le rapport.
  it("n'écrit jamais le slug (`pkg.name`) dans prospection.json ni prospection-state.json, seulement l'UUID", async () => {
    const dir = tmpDir();
    const outJsonPath = join(dir, "prospection.json");
    const outStatePath = join(dir, "prospection-state.json");
    await prospectSources({
      fetchImpl: fixtureFetch(),
      sleepImpl: noOp,
      maxPages: 1,
      pageSize: ALL_FIXTURES.length,
      outJsonPath,
      outMdPath: join(dir, "prospection.md"),
      outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 6),
    });
    const jsonText = readFileSync(outJsonPath, "utf8");
    const stateText = readFileSync(outStatePath, "utf8");
    for (const pkg of ALL_FIXTURES) {
      if (pkg.name === pkg.id) continue; // rien à distinguer pour ce jeu
      expect(jsonText).not.toContain(pkg.name);
      expect(stateText).not.toContain(pkg.name);
    }
  });

  it("la date d'exécution n'apparaît QUE dans generated_on (déterminisme du contenu)", async () => {
    const reportA = await run(Date.UTC(2026, 9, 6));
    const reportB = await run(Date.UTC(2099, 0, 1));
    const { generated_on: genA, ...restA } = reportA;
    const { generated_on: genB, ...restB } = reportB;
    expect(genA).not.toBe(genB);
    expect(restA).toEqual(restB);
  });

  it("deux exécutions identiques produisent un JSON strictement identique (tri déterministe)", async () => {
    const a = await run(Date.UTC(2026, 9, 6));
    const b = await run(Date.UTC(2026, 9, 6));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("si la SONDE (rows=0) échoue deux fois, stopped_reason = probe_failed, aucune page lue", async () => {
    let calls = 0;
    const flaky = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("package_search")) throw new Error("appel CSV inattendu");
      calls++;
      return new Response("erreur serveur", { status: 500 });
    }) as unknown as typeof fetch;
    const dir = tmpDir();
    const { report } = await prospectSources({
      fetchImpl: flaky,
      sleepImpl: noOp,
      maxPages: 3,
      pageSize: 10,
      outJsonPath: join(dir, "prospection.json"),
      outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"),
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 6),
    });
    expect(report.run.partial).toBe(true);
    expect(report.run.stopped_reason).toBe("probe_failed");
    expect(report.run.pages_read).toBe(0);
    expect(calls).toBe(2); // un essai + une retentative, jamais plus
  });

  it("si la sonde réussit mais une PAGE échoue deux fois, stopped_reason = page_failed", async () => {
    let pageCalls = 0;
    const flaky = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("package_search")) throw new Error("appel CSV inattendu");
      if (url.includes("rows=0&")) return makeSearchResponse(500, []); // sonde OK : catalogue de 500 jeux
      pageCalls++;
      return new Response("erreur serveur", { status: 500 });
    }) as unknown as typeof fetch;
    const dir = tmpDir();
    const { report } = await prospectSources({
      fetchImpl: flaky,
      sleepImpl: noOp,
      maxPages: 3,
      pageSize: 10,
      outJsonPath: join(dir, "prospection.json"),
      outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"),
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 6),
    });
    expect(report.run.partial).toBe(true);
    expect(report.run.stopped_reason).toBe("page_failed");
    expect(report.run.pages_read).toBe(0);
    expect(pageCalls).toBe(2); // un essai + une retentative, jamais plus
    expect(report.run.total_pages).toBe(50); // 500 jeux / 10 par page
  });
});

// ---------------------------------------------------------------------------------------
// Décision du 07.10.2026 : fenêtre tournante, fusion et expiration à 8 semaines.
// ---------------------------------------------------------------------------------------
describe("isoWeekNumber", () => {
  it("le 4 janvier est toujours en semaine ISO 1 (règle ISO 8601)", () => {
    expect(isoWeekNumber(new Date(Date.UTC(2026, 0, 4)))).toBe(1);
    expect(isoWeekNumber(new Date(Date.UTC(2027, 0, 4)))).toBe(1);
  });
  it("deux lundis consécutifs (hors frontière d'année) diffèrent d'une semaine", () => {
    const w1 = isoWeekNumber(new Date(Date.UTC(2026, 9, 5))); // lundi 05.10.2026
    const w2 = isoWeekNumber(new Date(Date.UTC(2026, 9, 12))); // lundi 12.10.2026
    expect(w2).toBe(w1 + 1);
  });
});

describe("computeStartPage / rotatingPageSequence", () => {
  it("retombe sur 0 si totalPages <= 0 (garde défensive)", () => {
    expect(computeStartPage(10, 0, 55)).toBe(0);
  });
  it("applique le modulo demandé (semaine × pas) mod total_pages", () => {
    expect(computeStartPage(2, 100, 55)).toBe(110 % 100); // = 10
    expect(computeStartPage(3, 100, 55)).toBe(165 % 100); // = 65
  });
  it("rotatingPageSequence boucle sur le catalogue sans jamais relire une page deux fois dans le même passage", () => {
    const seq = rotatingPageSequence(97, 100, 10);
    expect(seq).toEqual([97, 98, 99, 0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(seq).size).toBe(seq.length);
  });
  it("se borne au nombre total de pages si le catalogue est plus petit que le plafond du passage", () => {
    const seq = rotatingPageSequence(0, 3, 55);
    expect(seq).toEqual([0, 1, 2]);
  });
});

describe("toIsoDate / daysBetweenIso", () => {
  it("convertit un epoch ms en AAAA-MM-JJ (UTC)", () => {
    expect(toIsoDate(Date.UTC(2026, 9, 7, 23, 59))).toBe("2026-10-07");
  });
  it("calcule un nombre de jours entier entre deux dates ISO", () => {
    expect(daysBetweenIso("2026-08-12", "2026-10-07")).toBe(56); // exactement 8 semaines
    expect(daysBetweenIso("2026-10-07", "2026-10-07")).toBe(0);
  });
});

describe("loadState / serializeState — tuples compacts, tolérants aux lignes corrompues", () => {
  it("aller-retour fidèle", () => {
    const map = new Map<string, StateEntry>([
      ["jeu-a", { seen_on: "2026-10-07", status: "candidate" }],
      ["jeu-b", { seen_on: "2026-09-01", status: "licence_non_ouverte" }],
    ]);
    const rows = serializeState(map);
    expect(rows).toEqual([
      ["jeu-a", "2026-10-07", "candidate"],
      ["jeu-b", "2026-09-01", "licence_non_ouverte"],
    ]);
    const dir = tmpDir();
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify(rows));
    const reloaded = loadState(path);
    expect(reloaded.get("jeu-a")).toEqual({ seen_on: "2026-10-07", status: "candidate" });
    expect(reloaded.get("jeu-b")).toEqual({ seen_on: "2026-09-01", status: "licence_non_ouverte" });
  });
  it("un fichier absent ou corrompu donne un état vide, jamais une erreur", () => {
    expect(loadState("/chemin/qui/n-existe-pas.json").size).toBe(0);
    const dir = tmpDir();
    const path = join(dir, "corrompu.json");
    writeFileSync(path, "{ pas du JSON valide");
    expect(loadState(path).size).toBe(0);
  });
  it("ignore une ligne malformée sans faire échouer les autres", () => {
    const dir = tmpDir();
    const path = join(dir, "partiel.json");
    writeFileSync(path, JSON.stringify([["bon", "2026-10-07", "candidate"], ["mauvais"], 42]));
    const map = loadState(path);
    expect(map.size).toBe(1);
    expect(map.get("bon")).toEqual({ seen_on: "2026-10-07", status: "candidate" });
  });
});

describe("prospectSources — fusion entre deux passages (décision du 07.10.2026)", () => {
  function makeDataset(id: string, extra: Partial<CkanPackage> = {}): CkanPackage {
    // Hérite des ressources de `streets` (déjà terms_open, aucune ressource CSV : aucun appel
    // réseau de lecture d'en-tête n'est nécessaire, la clé vient du titre). `id` ET `name` sont
    // tous deux fixés au paramètre : depuis le 07.10.2026, l'identité d'un jeu est `pkg.id`
    // (UUID technique), jamais `pkg.name` (slug) — sans ce `id:`, tous les faux jeux de test
    // partageraient l'UUID réel de `streets` et s'écraseraient entre eux dans la fusion.
    return {
      ...streets,
      id,
      name: id,
      title: { fr: `Jeu ${id} par commune` },
      // Ressource CSV ajoutée le 07.10.2026 (relecture Focus 1, point 3) : `csv_inspected`
      // exige désormais une lecture d'en-tête RÉUSSIE pour qu'un candidat soit publiable — sans
      // ressource CSV du tout (ce qu'héritait `streets` seul), aucun des faux jeux de ce bloc ne
      // le serait plus jamais. L'en-tête servi (voir `fetchCsvOr`) ne contient par lui-même
      // aucune clé de jointure : celle-ci continue sciemment de venir du TITRE (« par commune »)
      // dans ces tests, comme avant — seule la preuve de lecture change.
      // AJOUTÉE à celles de `streets` (jamais un remplacement) : `streets.resources` porte le
      // `rights: terms_open` qui rend le jeu candidat — l'écraser l'aurait fait basculer en
      // licence_absente, donc exclu, avant même d'atteindre la lecture d'en-tête.
      resources: [...(streets.resources ?? []), { url: `https://example.test/csv/${id}.csv`, format: "CSV" }],
      ...extra,
    };
  }

  // Sert un en-tête CSV lisible (sans clé de jointure ni colonne de personne) pour toute
  // adresse `/csv/`, sinon délègue à `onSearch` (sonde `rows=0&` ou page de résultats).
  function fetchCsvOr(onSearch: (url: string) => Response): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/csv/")) return new Response("Colonne1;Colonne2\n", { status: 200 });
      return onSearch(url);
    }) as unknown as typeof fetch;
  }

  it("un candidat trouvé lors d'un passage reste dans le rapport du passage suivant, même sans être relu", async () => {
    const dir = tmpDir();
    const outJsonPath = join(dir, "prospection.json");
    const outMdPath = join(dir, "prospection.md");
    const outStatePath = join(dir, "prospection-state.json");

    const datasetA = makeDataset("jeu-a");
    const fetchPass1 = fetchCsvOr((url) => {
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      return makeSearchResponse(1, [datasetA]);
    });
    const pass1 = await prospectSources({
      fetchImpl: fetchPass1, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath, outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 5), // lundi
    });
    expect(pass1.report.candidates.map((c) => c.id)).toEqual(["jeu-a"]);

    // Second passage, une semaine plus tard : ne relit PAS jeu-a (mock différent), mais le
    // rapport fusionné doit encore le contenir, carried-forward depuis l'état précédent.
    const datasetB = makeDataset("jeu-b");
    const fetchPass2 = fetchCsvOr((url) => {
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      return makeSearchResponse(1, [datasetB]);
    });
    const pass2 = await prospectSources({
      fetchImpl: fetchPass2, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath, outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 12), // lundi suivant
    });
    const ids = pass2.report.candidates.map((c) => c.id).sort();
    expect(ids).toEqual(["jeu-a", "jeu-b"]);
    expect(pass2.report.totals.candidates).toBe(2);
  });

  // Revue du 07.10.2026 : le filtre public (fédéral/cantonal + clé) retire un candidat communal
  // de `prospection.json`, mais il doit RESTER "candidate" dans `prospection-state.json` d'un
  // passage à l'autre — sinon la purge de cohérence (qui ne devait viser que les lignes d'un
  // schéma ancien) l'efface à tort dès qu'il n'est pas relu, et son décompte cumulé est perdu.
  it("un candidat communal (hors filtre public) n'est jamais perdu de l'état entre deux passages, même s'il ne reparaît jamais dans prospection.json", async () => {
    const dir = tmpDir();
    const outJsonPath = join(dir, "prospection.json");
    const outMdPath = join(dir, "prospection.md");
    const outStatePath = join(dir, "prospection-state.json");

    const communal = makeDataset("jeu-communal", {
      organization: { ...streets.organization, political_level: "commune" },
    });
    const fetchPass1 = fetchCsvOr((url) => {
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      return makeSearchResponse(1, [communal]);
    });
    const pass1 = await prospectSources({
      fetchImpl: fetchPass1, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath, outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 5),
    });
    // Jamais dans le rapport public (niveau communal, filtre du 07.10.2026) — c'est VOULU.
    expect(pass1.report.candidates.map((c) => c.id)).not.toContain("jeu-communal");
    expect(pass1.report.totals.candidates).toBe(1);
    expect(loadState(outStatePath).get("jeu-communal")?.status).toBe("candidate");

    // Second passage, une semaine plus tard : ne relit PAS jeu-communal.
    const autre = makeDataset("jeu-autre");
    const fetchPass2 = fetchCsvOr((url) => {
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      return makeSearchResponse(1, [autre]);
    });
    const pass2 = await prospectSources({
      fetchImpl: fetchPass2, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath, outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 12),
    });
    expect(loadState(outStatePath).get("jeu-communal")?.status).toBe("candidate");
    expect(pass2.report.totals.candidates).toBe(2); // jeu-communal + jeu-autre, jamais perdu
  });

  it("un jeu non revu depuis plus de maxAgeDays est retiré de l'état et des candidats", async () => {
    const dir = tmpDir();
    const outStatePath = join(dir, "prospection-state.json");
    const outJsonPath = join(dir, "prospection.json");
    // État et rapport pré-existants : un jeu "vieux-jeu" vu il y a 60 jours (> 56 par défaut).
    writeFileSync(outStatePath, JSON.stringify([["vieux-jeu", "2026-08-08", "candidate"]]));
    writeFileSync(outJsonPath, JSON.stringify({
      generated_on: "2026-08-08", source: "x", run: { total_pages: 1 } as unknown,
      totals: { candidates: 1, excluded: 0, excluded_by_motif: {} },
      candidates: [{ id: "vieux-jeu", title: "Vieux jeu", publisher: "x", editor_level: "confederation", url: "https://x", licence: "terms_open", formats: [], frequency: null, modified: null, join_keys: ["commune (titre)"], a_verifier_ofs: false, a_verifier_personnes: "a_verifier", deja_collecte: false, status_note: null }],
      already_collected: [],
    }));
    const fetchImpl = fetchCsvOr((url) => {
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      return makeSearchResponse(1, [makeDataset("jeu-frais")]);
    });
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath: join(dir, "prospection.md"), outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 7), // 60 jours après le 08.08.2026
    });
    const ids = report.candidates.map((c) => c.id);
    expect(ids).not.toContain("vieux-jeu");
    expect(ids).toContain("jeu-frais");
  });

  // Signalé par la revue du 07.10.2026 : un `prospection.json` d'AVANT le renommage (schéma
  // ancien — identifiant = slug, champ `editor`, pas de `publisher` ni `status_note`, adresse
  // `/fr/dataset/<slug>`) ne doit JAMAIS être repris tel quel dans la fusion : ni le slug ni le
  // champ manquant ne doivent réapparaître dans le rapport régénéré.
  it("un rapport pré-existant au schéma ANCIEN (slug, editor, sans publisher) n'est jamais repris dans la fusion", async () => {
    const dir = tmpDir();
    const outStatePath = join(dir, "prospection-state.json");
    const outJsonPath = join(dir, "prospection.json");
    writeFileSync(outStatePath, JSON.stringify([["un-vieux-slug-de-jeu", "2026-10-06", "candidate"]]));
    writeFileSync(outJsonPath, JSON.stringify({
      generated_on: "2026-10-06", source: "x", run: { total_pages: 1 } as unknown,
      totals: { candidates: 1, excluded: 0, excluded_by_motif: {} },
      candidates: [{
        id: "un-vieux-slug-de-jeu", title: "Vieux jeu (ancien schéma)", editor: "x",
        editor_level: "confederation", url: "https://opendata.swiss/fr/dataset/un-vieux-slug-de-jeu",
        licence: "terms_open", formats: [], frequency: null, modified: null,
        join_keys: ["commune (titre)"], a_verifier_ofs: false, a_verifier_personnes: "a_verifier",
        deja_collecte: false,
      }],
      already_collected: [],
    }));
    const fetchImpl = fetchCsvOr((url) => {
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      return makeSearchResponse(1, [makeDataset("jeu-frais-2")]);
    });
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath: join(dir, "prospection.md"), outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 7),
    });
    expect(report.candidates.map((c) => c.id)).not.toContain("un-vieux-slug-de-jeu");
    for (const c of report.candidates) {
      expect(typeof c.publisher).toBe("string");
      expect(c.url).not.toContain("un-vieux-slug-de-jeu");
      expect(c.url).not.toContain("/fr/dataset/");
    }
    const jsonText = readFileSync(outJsonPath, "utf8");
    expect(jsonText).not.toContain("un-vieux-slug-de-jeu");
    // La ligne d'état orpheline (status="candidate" sans enregistrement correspondant) doit
    // elle aussi disparaître de l'état régénéré — sinon elle gonflerait les totaux cumulés et
    // referait surface à chaque passage suivant.
    const stateText = readFileSync(outStatePath, "utf8");
    expect(stateText).not.toContain("un-vieux-slug-de-jeu");
    expect(report.totals.candidates).toBe(1); // seul "jeu-frais-2" ce passage, pas le doublon fantôme
  });

  it("la limite de temps interne arrête le passage avant la fin, stopped_reason = time_limit, code de sortie 2 attendu", async () => {
    const dir = tmpDir();
    let t = Date.UTC(2026, 9, 12);
    const nowFn = () => (t += 600); // 600 ms par appel : dépasse timeLimitMs=1000 après la page 1
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rows=0&")) return makeSearchResponse(2, []);
      return makeSearchResponse(2, [makeDataset("jeu-limite")]);
    }) as unknown as typeof fetch;
    const outJsonPath = join(dir, "prospection.json");
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 2, pageSize: 1, timeLimitMs: 1000,
      outJsonPath, outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"), outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: nowFn,
    });
    expect(report.run.stopped_reason).toBe("time_limit");
    expect(report.run.partial).toBe(true);
    expect(report.run.pages_read).toBe(1); // arrêté avant la 2e page visée
    expect(existsSync(outJsonPath)).toBe(true); // le rapport partiel est bien écrit (le workflow le committe quand même)
  });

  // Relecture Focus 1 du 07.10.2026 (point 6) : la limite de temps doit aussi être vérifiée
  // AVANT chaque lecture d'en-tête CSV, pas seulement entre deux pages — sinon une seule page
  // avec plusieurs jeux à ressources CSV lentes pouvait dépasser largement le budget.
  it("la limite de temps coupe AUSSI dans une page, entre deux jeux : le second en-tête CSV n'est jamais lu", async () => {
    const dir = tmpDir();
    const start = Date.UTC(2026, 9, 12);
    let n = 0;
    const nowFn = () => { n++; return start + n * 400; }; // franchit timeLimitMs=1000 au 4e appel
    const csvFetched: string[] = [];
    const jeu1 = makeDataset("jeu-page-1", { resources: [...(streets.resources ?? []), { url: "https://example.test/csv/jeu-page-1.csv", format: "CSV" }] });
    const jeu2 = makeDataset("jeu-page-2", { resources: [...(streets.resources ?? []), { url: "https://example.test/csv/jeu-page-2.csv", format: "CSV" }] });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rows=0&")) return makeSearchResponse(2, []);
      if (url.includes("/csv/")) { csvFetched.push(url); return new Response("Colonne1;Colonne2\n", { status: 200 }); }
      return makeSearchResponse(2, [jeu1, jeu2]); // UNE page, deux jeux
    }) as unknown as typeof fetch;
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 2, timeLimitMs: 1000,
      outJsonPath: join(dir, "prospection.json"), outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"), outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: nowFn,
    });
    expect(report.run.stopped_reason).toBe("time_limit");
    expect(csvFetched.some((u) => u.includes("jeu-page-1"))).toBe(true);
    expect(csvFetched.some((u) => u.includes("jeu-page-2"))).toBe(false); // jamais atteint
  });

  it("ne garde que les 300 meilleurs candidats en détail, mais le total cumulé reste le vrai compte", async () => {
    const dir = tmpDir();
    const many: CkanPackage[] = Array.from({ length: 301 }, (_, i) => makeDataset(`jeu-${String(i).padStart(3, "0")}`));
    const fetchImpl = fetchCsvOr((url) => {
      if (url.includes("rows=0&")) return makeSearchResponse(301, []);
      return makeSearchResponse(301, many);
    });
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 301,
      outJsonPath: join(dir, "prospection.json"), outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"), outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 12),
    });
    expect(report.candidates.length).toBe(300);
    expect(report.totals.candidates).toBe(301);
  });
});

describe("prospectSources — une colonne de personne reclasse un jeu en exclu (Review Focus 1, décision du 07.10.2026)", () => {
  it("un jeu passé les marqueurs texte mais dont le CSV nomme un propriétaire n'est jamais candidat", async () => {
    const ofenLikeKev: CkanPackage = {
      ...streets, // licence terms_open, pas de marqueur de personnes dans le titre/description
      name: "ofen-kev-test",
      title: { fr: "Bénéficiaires de la rétribution de l'injection (RPC)" },
      resources: [
        { url: "https://example.test/ogd6_kev-bezueger.csv", format: "CSV", rights: "https://opendata.swiss/terms-of-use#terms_by" },
      ],
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("package_search")) return makeSearchResponse(1, [ofenLikeKev]);
      if (url.includes("kev-bezueger.csv")) {
        return new Response("anlage_plz,anlage_kanton,produzent_firma,produzent_name,produzent_vorname\n", { status: 206 });
      }
      throw new Error(`appel réseau inattendu : ${url}`);
    }) as unknown as typeof fetch;
    const dir = tmpDir();
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath: join(dir, "p.json"), outMdPath: join(dir, "p.md"),
      outStatePath: join(dir, "p-state.json"), outPassDetailPath: join(dir, "p-pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 6),
    });
    expect(report.candidates.map((c) => c.id)).not.toContain("ofen-kev-test");
    expect(report.totals.excluded_by_motif.colonne_personne).toBe(1);
  });
});

describe("buildFicheUrl", () => {
  it("reconstruit l'adresse opendata.swiss à partir de l'UUID technique, jamais du slug (décision du 07.10.2026)", () => {
    expect(buildFicheUrl("82fbb1cf-eb37-4c60-9b67-6e7b38dc7660")).toBe(
      "https://opendata.swiss/dataset/82fbb1cf-eb37-4c60-9b67-6e7b38dc7660",
    );
  });
});

describe("buildMarkdownReport — texte cohérent avec le format trimmé (décision du 07.10.2026)", () => {
  it("annonce le tableau des 30 meilleurs et ne prétend jamais à une liste intégrale", async () => {
    const dir = tmpDir();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/csv/")) return new Response("Colonne1;Colonne2\n", { status: 200 });
      return makeSearchResponse(ALL_FIXTURES.length, ALL_FIXTURES);
    }) as unknown as typeof fetch;
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: ALL_FIXTURES.length,
      outJsonPath: join(dir, "p.json"), outMdPath: join(dir, "p.md"),
      outStatePath: join(dir, "p-state.json"), outPassDetailPath: join(dir, "p-pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 6),
    });
    const md = buildMarkdownReport(report);
    expect(md).toContain("30 de chaque groupe");
    expect(md).not.toContain("liste intégrale");
    // Révision du 07.10.2026 : un jeu OFS doit avoir SA PROPRE section, jamais seulement
    // dépendre de place restante dans le premier tableau (sinon il n'apparaît jamais dès qu'il
    // y a plus de 30 candidats non-OFS — constat réel du passage du 07.10.2026 : 123 non-OFS).
    expect(md).toContain("## Jeux de l'OFS — droits à confirmer");
  });

  // Régression du 07.10.2026 : avec plus de 30 candidats non-OFS, un candidat OFS doit TOUJOURS
  // apparaître dans sa propre section, même s'il serait hors de la tranche des 30 premiers du
  // tableau combiné — c'est précisément le cas réel observé au premier passage sous ce schéma.
  it("un candidat OFS apparaît toujours, même avec plus de 30 candidats non-OFS avant lui", () => {
    function fakeCandidate(id: string, partial: Partial<ProspectionCandidate> = {}): ProspectionCandidate {
      return {
        id, title: `Jeu ${id}`, publisher: "x", editor_level: "confederation", url: `https://opendata.swiss/dataset/${id}`,
        licence: "terms_open", formats: [], frequency: null, modified: null, join_keys: ["npa"],
        a_verifier_ofs: false, a_verifier_personnes: "a_verifier", deja_collecte: false, status_note: null,
        ...partial,
      };
    }
    const nonOfs = Array.from({ length: 40 }, (_, i) => fakeCandidate(`non-ofs-${i}`));
    const ofs = fakeCandidate("ofs-1", {
      title: "Jeu de l'OFS caché par le tri ?", a_verifier_ofs: true, status_note: "droits à confirmer (OFS)",
    });
    const report: ProspectionReport = {
      generated_on: "2026-10-07", source: "opendata.swiss",
      run: {
        pages_read: 1, page_size: 1, max_pages: 1, start_page: 0, total_pages: 1,
        datasets_read: 41, datasets_total_catalog: 41, coverage_ratio: 1, partial: false, stopped_reason: "ok",
      },
      totals: { candidates: 41, excluded: 0, excluded_by_motif: {} },
      candidates: [...nonOfs, ofs], // déjà dans l'ordre public (non-OFS puis OFS)
      already_collected: [],
    };
    const md = buildMarkdownReport(report);
    expect(md).toContain("Jeu de l'OFS caché par le tri ?");
    expect(md).toContain("droits à confirmer (OFS)");
  });
});

describe("buildMarkdownReport — échappement des cellules (titre/éditeur libres)", () => {
  it("échappe le caractère | et remplace les sauts de ligne, sans casser le tableau", async () => {
    const dir = tmpDir();
    const withPipe: CkanPackage = {
      ...streets,
      name: "jeu-avec-pipe",
      title: { fr: "Titre | avec un\npipe et un saut de ligne, par commune" },
      resources: [...(streets.resources ?? []), { url: "https://example.test/csv/jeu-avec-pipe.csv", format: "CSV" }],
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/csv/")) return new Response("Colonne1;Colonne2\n", { status: 200 });
      return makeSearchResponse(1, [withPipe]);
    }) as unknown as typeof fetch;
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath: join(dir, "p.json"), outMdPath: join(dir, "p.md"),
      outStatePath: join(dir, "p-state.json"), outPassDetailPath: join(dir, "p-pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 6),
    });
    const md = buildMarkdownReport(report);
    const rows = md.split("\n").filter((l) => l.startsWith("| Titre \\|"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toContain("\n");
    // 9 colonnes (dont « Statut », ajoutée le 07.10.2026 pour l'annotation OFS) → 10 barres
    // verticales NON échappées (séparateurs réels) ; le | du titre, échappé en \|, ne doit
    // jamais s'ajouter à ce compte ni rompre le tableau.
    const unescapedPipes = rows[0].match(/(?<!\\)\|/g) ?? [];
    expect(unescapedPipes).toHaveLength(10);
  });
});

describe("buildMarkdownReport — contient les trois meilleurs candidats de la recherche manuelle", () => {
  it("le texte du tableau cite le titre des trois jeux swisstopo attendus", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/csv/")) return new Response("Colonne1;Colonne2\n", { status: 200 });
      return makeSearchResponse(ALL_FIXTURES.length, ALL_FIXTURES);
    }) as unknown as typeof fetch;
    const dir = tmpDir();
    const { report } = await prospectSources({
      fetchImpl,
      sleepImpl: noOp,
      maxPages: 1,
      pageSize: ALL_FIXTURES.length,
      outJsonPath: join(dir, "prospection.json"),
      outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"),
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 6),
    });
    const md = buildMarkdownReport(report);
    expect(md).toContain(pickLocalizedText(streets.title));
    expect(md).toContain(pickLocalizedText(limites.title));
    expect(md).toContain(pickLocalizedText(localites.title));
    expect(md).not.toContain(pickLocalizedText(regGeneve.title));
  });
});

describe("exitCodeFor — relecture Focus 1, point 6 : alerter sur un catalogue illisible, pas seulement sur la limite de temps", () => {
  it("time_limit → 2 (inchangé)", () => {
    expect(exitCodeFor({ stopped_reason: "time_limit", pages_read: 10 })).toBe(2);
  });
  it("probe_failed → 3, même si pages_read est resté à 0", () => {
    expect(exitCodeFor({ stopped_reason: "probe_failed", pages_read: 0 })).toBe(3);
  });
  it("page_failed → 3", () => {
    expect(exitCodeFor({ stopped_reason: "page_failed", pages_read: 0 })).toBe(3);
  });
  it("ok mais AUCUNE page lue → 3 (catalogue non vérifié, jamais un succès silencieux)", () => {
    expect(exitCodeFor({ stopped_reason: "ok", pages_read: 0 })).toBe(3);
  });
  it("ok et au moins une page lue → 0", () => {
    expect(exitCodeFor({ stopped_reason: "ok", pages_read: 1 })).toBe(0);
  });
});

describe("detectIdeColumn", () => {
  it("accepte la liste fermée, exacte après normalisation", () => {
    expect(detectIdeColumn(["uid"])).toBe(true);
    expect(detectIdeColumn(["unternehmens_id"])).toBe(true);
  });
  it("refuse tout *_uid hors la liste fermée (bug réel du Grand Conseil bernois)", () => {
    expect(detectIdeColumn(["mitglied_uid"])).toBe(false);
    expect(detectIdeColumn(["votum_uid"])).toBe(false);
  });
});

describe("reclassifyOffline — correctif SANS passage réseau (relecture Focus 1, point 2)", () => {
  function candidate(partial: Partial<ProspectionCandidate>): ProspectionCandidate {
    return {
      id: "x", title: "x", publisher: "x", editor_level: "confederation", url: "https://x",
      licence: "terms_open", formats: [], frequency: null, modified: null, join_keys: ["commune (titre)"],
      a_verifier_ofs: false, a_verifier_personnes: "a_verifier", deja_collecte: false, status_note: null,
      csv_inspected: true,
      ...partial,
    };
  }
  it("retire les id forcés du rapport public et les reclasse dans l'état, sans toucher les autres", () => {
    const stateMap = new Map<string, StateEntry>([
      ["a-garder", { seen_on: "2026-10-06", status: "candidate" }],
      ["b-a-exclure", { seen_on: "2026-10-06", status: "candidate" }],
    ]);
    const previousReport: ProspectionReport = {
      generated_on: "2026-10-06", source: "x",
      run: { pages_read: 1, page_size: 1, max_pages: 1, start_page: 0, total_pages: 1, datasets_read: 2, datasets_total_catalog: 2, coverage_ratio: 1, partial: false, stopped_reason: "ok" },
      totals: { candidates: 2, excluded: 0, excluded_by_motif: {} },
      candidates: [candidate({ id: "a-garder", join_keys: ["npa"] }), candidate({ id: "b-a-exclure", join_keys: ["ide"] })],
      already_collected: [],
    };
    const result = reclassifyOffline(stateMap, previousReport, [{ id: "b-a-exclure", motif: "colonne_personne" }], "2026-10-07");
    expect(result.candidates.map((c) => c.id)).toEqual(["a-garder"]);
    expect(result.totals.candidates).toBe(1);
    expect(result.totals.excluded_by_motif.colonne_personne).toBe(1);
    expect(stateMap.get("b-a-exclure")?.status).toBe("colonne_personne");
  });
  it("relance detectPersonMarkers (liste à jour) sur le TITRE des candidats restants, et les reclasse si une correspondance apparaît", () => {
    const stateMap = new Map<string, StateEntry>([["membre-id", { seen_on: "2026-10-06", status: "candidate" }]]);
    const previousReport: ProspectionReport = {
      generated_on: "2026-10-06", source: "x",
      run: { pages_read: 1, page_size: 1, max_pages: 1, start_page: 0, total_pages: 1, datasets_read: 1, datasets_total_catalog: 1, coverage_ratio: 1, partial: false, stopped_reason: "ok" },
      totals: { candidates: 1, excluded: 0, excluded_by_motif: {} },
      candidates: [candidate({ id: "membre-id", title: "Participation des députés aux affaires du Grand Conseil" })],
      already_collected: [],
    };
    const result = reclassifyOffline(stateMap, previousReport, [], "2026-10-07");
    expect(result.candidates).toEqual([]);
    expect(stateMap.get("membre-id")?.status).toBe("personnes_detectees");
  });
  it("déduit csv_inspected=false quand toutes les clés de jointure viennent du titre (jamais supposé prouvé sans preuve)", () => {
    const stateMap = new Map<string, StateEntry>([["titre-seul", { seen_on: "2026-10-06", status: "candidate" }]]);
    const previousReport: ProspectionReport = {
      generated_on: "2026-10-06", source: "x",
      run: { pages_read: 1, page_size: 1, max_pages: 1, start_page: 0, total_pages: 1, datasets_read: 1, datasets_total_catalog: 1, coverage_ratio: 1, partial: false, stopped_reason: "ok" },
      totals: { candidates: 1, excluded: 0, excluded_by_motif: {} },
      candidates: [candidate({ id: "titre-seul", join_keys: ["commune (titre)"] })],
      already_collected: [],
    };
    const result = reclassifyOffline(stateMap, previousReport, [], "2026-10-07");
    expect(result.candidates).toEqual([]); // plus publiable : csv_inspected=false désormais déduit
  });
});

describe("prospectSources — exclusion durable colonne_personne (relecture Focus 1, point 4)", () => {
  function makeDataset(id: string, extra: Partial<CkanPackage> = {}): CkanPackage {
    return { ...streets, id, name: id, title: { fr: `Jeu ${id}` }, ...extra };
  }
  it("un échec de lecture d'en-tête ne libère JAMAIS une exclusion colonne_personne déjà posée", async () => {
    const dir = tmpDir();
    const outStatePath = join(dir, "prospection-state.json");
    const outJsonPath = join(dir, "prospection.json");
    writeFileSync(outStatePath, JSON.stringify([["jeu-exclu", "2026-10-06", "colonne_personne"]]));
    const withCsv = makeDataset("jeu-exclu", {
      resources: [...(streets.resources ?? []), { url: "https://example.test/csv/jeu-exclu.csv", format: "CSV" }],
    });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      if (url.includes("/csv/")) return new Response("panne", { status: 500 }); // échec de lecture
      return makeSearchResponse(1, [withCsv]);
    }) as unknown as typeof fetch;
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath: join(dir, "prospection.md"), outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 13),
    });
    expect(loadState(outStatePath).get("jeu-exclu")?.status).toBe("colonne_personne");
    expect(report.totals.excluded_by_motif.colonne_personne).toBe(1);
    expect(report.candidates.map((c) => c.id)).not.toContain("jeu-exclu");
  });
  it("aucune ressource CSV du tout ne libère pas non plus l'exclusion (rien à relire ne vaut jamais relecture propre)", async () => {
    const dir = tmpDir();
    const outStatePath = join(dir, "prospection-state.json");
    const outJsonPath = join(dir, "prospection.json");
    writeFileSync(outStatePath, JSON.stringify([["jeu-exclu-2", "2026-10-06", "colonne_personne"]]));
    const sansCsv = makeDataset("jeu-exclu-2"); // hérite des ressources de `streets` : aucune CSV
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      return makeSearchResponse(1, [sansCsv]);
    }) as unknown as typeof fetch;
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath: join(dir, "prospection.md"), outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 13),
    });
    expect(loadState(outStatePath).get("jeu-exclu-2")?.status).toBe("colonne_personne");
    expect(report.candidates.map((c) => c.id)).not.toContain("jeu-exclu-2");
  });
  it("une relecture RÉUSSIE et propre (sans colonne de personne) libère bien l'exclusion", async () => {
    const dir = tmpDir();
    const outStatePath = join(dir, "prospection-state.json");
    const outJsonPath = join(dir, "prospection.json");
    writeFileSync(outStatePath, JSON.stringify([["jeu-libere", "2026-10-06", "colonne_personne"]]));
    const withCsv = makeDataset("jeu-libere", {
      title: { fr: "Jeu jeu-libere par commune" },
      resources: [...(streets.resources ?? []), { url: "https://example.test/csv/jeu-libere.csv", format: "CSV" }],
    });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      if (url.includes("/csv/")) return new Response("Colonne1;Colonne2\n", { status: 200 }); // lecture propre
      return makeSearchResponse(1, [withCsv]);
    }) as unknown as typeof fetch;
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath: join(dir, "prospection.md"), outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 13),
    });
    expect(loadState(outStatePath).get("jeu-libere")?.status).toBe("candidate");
    expect(report.candidates.map((c) => c.id)).toContain("jeu-libere");
  });

  // Correction suite à la relecture du 07.10.2026 : `headersRead > 0` seul (« au moins un en-tête
  // relu ») aurait libéré l'exclusion dès qu'UNE SEULE des ressources CSV se lit, même si une
  // AUTRE (justement celle qui porterait la colonne de personne) échoue. La libération exige que
  // TOUTES les ressources tentées ce passage se soient lues avec succès.
  it("un échec PARTIEL (une ressource CSV sur deux) ne libère pas non plus l'exclusion", async () => {
    const dir = tmpDir();
    const outStatePath = join(dir, "prospection-state.json");
    const outJsonPath = join(dir, "prospection.json");
    writeFileSync(outStatePath, JSON.stringify([["jeu-partiel", "2026-10-06", "colonne_personne"]]));
    const withTwoCsv = makeDataset("jeu-partiel", {
      resources: [
        ...(streets.resources ?? []),
        { url: "https://example.test/csv/jeu-partiel-1.csv", format: "CSV" }, // échoue (500)
        { url: "https://example.test/csv/jeu-partiel-2.csv", format: "CSV" }, // se lit, propre
      ],
    });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      if (url.includes("jeu-partiel-1.csv")) return new Response("panne", { status: 500 });
      if (url.includes("jeu-partiel-2.csv")) return new Response("Colonne1;Colonne2\n", { status: 200 });
      return makeSearchResponse(1, [withTwoCsv]);
    }) as unknown as typeof fetch;
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath, outMdPath: join(dir, "prospection.md"), outStatePath,
      outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath: join(dir, "prospection-exclusions.json"),
      now: () => Date.UTC(2026, 9, 13),
    });
    expect(loadState(outStatePath).get("jeu-partiel")?.status).toBe("colonne_personne");
    expect(report.candidates.map((c) => c.id)).not.toContain("jeu-partiel");
  });
});

describe("rereadForPersonMarkers — relecture ciblée des candidats publics (décision du 07.10.2026, point 1)", () => {
  function candidate(partial: Partial<ProspectionCandidate>): ProspectionCandidate {
    return {
      id: "x", title: "x", publisher: "x", editor_level: "confederation", url: "https://x",
      licence: "terms_open", formats: [], frequency: null, modified: null, join_keys: ["npa"],
      a_verifier_ofs: false, a_verifier_personnes: "a_verifier", deja_collecte: false, status_note: null,
      csv_inspected: true,
      ...partial,
    };
  }
  function showResponse(pkg: Partial<CkanPackage> & { id: string }): Response {
    const full: CkanPackage = { name: pkg.id, resources: [], ...pkg } as CkanPackage;
    return new Response(JSON.stringify({ success: true, result: full }), { status: 200 });
  }

  it("un jeu propre (description et en-têtes sans marqueur) survit, csv_inspected recalculé à true", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("package_show")) {
        return showResponse({ id: "ok-1", title: { fr: "Jeu propre" }, resources: [{ url: "https://example.test/csv/ok-1.csv", format: "CSV" }] });
      }
      return new Response("Colonne1;Colonne2\n", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await rereadForPersonMarkers([candidate({ id: "ok-1" })], {
      fetchImpl, userAgent: "UA", timeoutMs: 1000, delayMs: 0, sleepImpl: noOp, maxCalls: 400,
    });
    expect(result.survivors.map((c) => c.id)).toEqual(["ok-1"]);
    expect(result.survivors[0].csv_inspected).toBe(true);
    expect(result.excluded).toEqual([]);
    expect(result.unverified).toEqual([]);
    expect(result.callsMade).toBe(2); // 1 package_show + 1 csv
  });

  it("une description qui porte un marqueur de personnes exclut le jeu (motif personnes_detectees), sans lire son CSV", async () => {
    const csvCalls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("package_show")) {
        return showResponse({
          id: "desc-personne", title: { fr: "Jeu" }, description: { fr: "Liste avec Kontaktperson et adresse" },
          resources: [{ url: "https://example.test/csv/desc-personne.csv", format: "CSV" }],
        });
      }
      csvCalls.push(url);
      return new Response("Colonne1;Colonne2\n", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await rereadForPersonMarkers([candidate({ id: "desc-personne" })], {
      fetchImpl, userAgent: "UA", timeoutMs: 1000, delayMs: 0, sleepImpl: noOp, maxCalls: 400,
    });
    expect(result.excluded).toEqual([{ id: "desc-personne", title: "x", motif: "personnes_detectees" }]);
    expect(csvCalls).toEqual([]); // jamais lu : la description seule a suffi à exclure
  });

  it("une colonne de personne dans l'en-tête exclut le jeu (motif colonne_personne)", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("package_show")) {
        return showResponse({ id: "col-personne", title: { fr: "Jeu" }, resources: [{ url: "https://example.test/csv/col-personne.csv", format: "CSV" }] });
      }
      return new Response("Firma;Kontaktperson;Email\n", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await rereadForPersonMarkers([candidate({ id: "col-personne" })], {
      fetchImpl, userAgent: "UA", timeoutMs: 1000, delayMs: 0, sleepImpl: noOp, maxCalls: 400,
    });
    expect(result.excluded).toEqual([{ id: "col-personne", title: "x", motif: "colonne_personne" }]);
  });

  it("aucun en-tête relisible cette nuit (package_show en échec) → non vérifié, retiré du public SANS être exclu", async () => {
    const fetchImpl = (async () => new Response("panne", { status: 500 })) as unknown as typeof fetch;
    const result = await rereadForPersonMarkers([candidate({ id: "injoignable" })], {
      fetchImpl, userAgent: "UA", timeoutMs: 1000, delayMs: 0, sleepImpl: noOp, maxCalls: 400,
    });
    expect(result.unverified).toEqual(["injoignable"]);
    expect(result.excluded).toEqual([]);
    expect(result.survivors).toEqual([]);
  });

  it("aucune ressource CSV lisible (toutes échouent) → non vérifié, pas de fausse preuve de propreté", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("package_show")) {
        return showResponse({ id: "csv-en-echec", title: { fr: "Jeu" }, resources: [{ url: "https://example.test/csv/csv-en-echec.csv", format: "CSV" }] });
      }
      return new Response("panne", { status: 500 });
    }) as unknown as typeof fetch;
    const result = await rereadForPersonMarkers([candidate({ id: "csv-en-echec" })], {
      fetchImpl, userAgent: "UA", timeoutMs: 1000, delayMs: 0, sleepImpl: noOp, maxCalls: 400,
    });
    expect(result.unverified).toEqual(["csv-en-echec"]);
  });

  it("respecte le plafond d'appels : les jeux non atteints sortent en non-vérifiés, jamais traités", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("package_show")) return showResponse({ id: "peu-importe", title: { fr: "x" }, resources: [] });
      return new Response("Colonne1\n", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await rereadForPersonMarkers(
      [candidate({ id: "premier" }), candidate({ id: "second" })],
      { fetchImpl, userAgent: "UA", timeoutMs: 1000, delayMs: 0, sleepImpl: noOp, maxCalls: 1 }, // 1 seul appel budgété
    );
    expect(result.callsMade).toBe(1);
    expect(result.unverified).toContain("second");
    expect(seen).toHaveLength(1); // le second jeu n'a provoqué AUCUN appel réseau
  });
});

describe("loadExclusionBlacklist / serializeExclusionBlacklist — liste noire durable (décision du 07.10.2026, point 3)", () => {
  it("aller-retour fidèle, trié par id", () => {
    const entries: ExclusionEntry[] = [
      { id: "b", motif: "colonne_personne", date: "2026-10-07", note: "exclusion manuelle de l'intégrateur" },
      { id: "a", motif: "personnes_detectees", date: "2026-10-07", note: "exclusion manuelle de l'intégrateur" },
    ];
    const map = new Map(entries.map((e) => [e.id, e]));
    expect(serializeExclusionBlacklist(map)).toEqual([entries[1], entries[0]]);

    const dir = tmpDir();
    const path = join(dir, "exclusions.json");
    writeFileSync(path, JSON.stringify(serializeExclusionBlacklist(map)));
    const reloaded = loadExclusionBlacklist(path);
    expect(reloaded.get("a")).toEqual(entries[1]);
    expect(reloaded.get("b")).toEqual(entries[0]);
  });
  it("fichier absent → map vide, jamais une erreur", () => {
    expect(loadExclusionBlacklist("/chemin/qui-n-existe-pas.json").size).toBe(0);
  });
  // Relevé le 07.10.2026 : « n'en libère jamais un jeu » exige d'échouer sur un fichier présent
  // mais corrompu — un repli silencieux sur une liste vide aurait libéré TOUT le monde.
  it("fichier présent mais JSON invalide → lève (jamais un repli silencieux sur une liste vide)", () => {
    const dir = tmpDir();
    const path = join(dir, "exclusions.json");
    writeFileSync(path, "{ pas du json valide");
    expect(() => loadExclusionBlacklist(path)).toThrow();
  });
  it("une entrée mal formée (motif inconnu, id manquant) → lève", () => {
    const dir = tmpDir();
    const path = join(dir, "exclusions.json");
    writeFileSync(path, JSON.stringify([{ id: "x", motif: "motif_qui_n_existe_pas", date: "2026-10-07", note: "x" }]));
    expect(() => loadExclusionBlacklist(path)).toThrow();
    writeFileSync(path, JSON.stringify([{ motif: "colonne_personne", date: "2026-10-07", note: "x" }]));
    expect(() => loadExclusionBlacklist(path)).toThrow();
  });
});

describe("prospectSources — liste noire durable, jamais libérée même par une relecture propre (point 3)", () => {
  function makeDataset(id: string, extra: Partial<CkanPackage> = {}): CkanPackage {
    return {
      ...streets, id, name: id, title: { fr: `Jeu ${id} par commune` },
      resources: [...(streets.resources ?? []), { url: `https://example.test/csv/${id}.csv`, format: "CSV" }],
      ...extra,
    };
  }
  it("un id dans la liste noire reste exclu même si ce passage le reclasserait candidat (en-tête propre)", async () => {
    const dir = tmpDir();
    const outExclusionsPath = join(dir, "prospection-exclusions.json");
    writeFileSync(outExclusionsPath, JSON.stringify([
      { id: "jeu-liste-noire", motif: "colonne_personne", date: "2026-10-07", note: "exclusion manuelle de l'intégrateur" },
    ]));
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      if (url.includes("/csv/")) return new Response("Colonne1;Colonne2\n", { status: 200 }); // en-tête parfaitement propre
      return makeSearchResponse(1, [makeDataset("jeu-liste-noire")]);
    }) as unknown as typeof fetch;
    const { report } = await prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath: join(dir, "prospection.json"), outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"), outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath,
      now: () => Date.UTC(2026, 9, 14),
    });
    expect(report.candidates.map((c) => c.id)).not.toContain("jeu-liste-noire");
    expect(loadState(join(dir, "prospection-state.json")).get("jeu-liste-noire")?.status).toBe("colonne_personne");
  });

  it("un prospection-exclusions.json corrompu fait échouer tout le passage (jamais un repli silencieux qui libérerait la liste noire)", async () => {
    const dir = tmpDir();
    const outExclusionsPath = join(dir, "prospection-exclusions.json");
    writeFileSync(outExclusionsPath, "{ pas du json valide");
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("rows=0&")) return makeSearchResponse(1, []);
      return makeSearchResponse(1, [makeDataset("jeu-quelconque")]);
    }) as unknown as typeof fetch;
    await expect(prospectSources({
      fetchImpl, sleepImpl: noOp, maxPages: 1, pageSize: 1,
      outJsonPath: join(dir, "prospection.json"), outMdPath: join(dir, "prospection.md"),
      outStatePath: join(dir, "prospection-state.json"), outPassDetailPath: join(dir, "pass-detail.json"),
      outExclusionsPath,
      now: () => Date.UTC(2026, 9, 14),
    })).rejects.toThrow();
  });
});

describe("finalizeReport — assemblage formalisé (générateur et correctifs partagent la même fonction)", () => {
  function candidate(partial: Partial<ProspectionCandidate>): ProspectionCandidate {
    return {
      id: "x", title: "x", publisher: "x", editor_level: "confederation", url: "https://x",
      licence: "terms_open", formats: [], frequency: null, modified: null, join_keys: ["npa"],
      a_verifier_ofs: false, a_verifier_personnes: "a_verifier", deja_collecte: false, status_note: null,
      csv_inspected: true,
      ...partial,
    };
  }
  const run = {
    pages_read: 1, page_size: 1, max_pages: 1, start_page: 0, total_pages: 1,
    datasets_read: 2, datasets_total_catalog: 2, coverage_ratio: 1, partial: false, stopped_reason: "ok" as const,
  };

  it("applique la liste noire EN DERNIER (un id blacklisté reste exclu même marqué candidate dans l'état)", () => {
    const stateMap = new Map<string, StateEntry>([
      ["a", { seen_on: "2026-10-07", status: "candidate" }],
      ["b", { seen_on: "2026-10-07", status: "candidate" }], // sera repris par la liste noire
    ]);
    const candidatesPool = new Map([
      ["a", candidate({ id: "a" })],
      ["b", candidate({ id: "b" })],
    ]);
    const exclusionBlacklist = new Map<string, ExclusionEntry>([
      ["b", { id: "b", motif: "colonne_personne", date: "2026-10-07", note: "exclusion manuelle de l'intégrateur" }],
    ]);
    const report = finalizeReport({
      stateMap, candidatesPool, exclusionBlacklist, alreadyCollected: new Set(["b"]),
      generatedOn: "2026-10-07", source: "x", run,
    });
    expect(report.candidates.map((c) => c.id)).toEqual(["a"]);
    expect(report.totals.candidates).toBe(1);
    expect(report.totals.excluded_by_motif.colonne_personne).toBe(1);
    expect(report.already_collected).toEqual([]); // "b" retiré par la liste noire
    expect(stateMap.get("b")?.status).toBe("colonne_personne");
  });

  it("filtre public (isPublishableCandidate) et ordre OFS-après (orderForPublicDisplay) appliqués tels quels", () => {
    const stateMap = new Map<string, StateEntry>([
      ["ofs", { seen_on: "2026-10-07", status: "candidate" }],
      ["non-ofs", { seen_on: "2026-10-07", status: "candidate" }],
      ["sans-cle", { seen_on: "2026-10-07", status: "candidate" }],
    ]);
    const candidatesPool = new Map([
      ["ofs", candidate({ id: "ofs", a_verifier_ofs: true })],
      ["non-ofs", candidate({ id: "non-ofs" })],
      ["sans-cle", candidate({ id: "sans-cle", join_keys: [] })], // filtré : aucune clé
    ]);
    const report = finalizeReport({
      stateMap, candidatesPool, exclusionBlacklist: new Map(), alreadyCollected: new Set(),
      generatedOn: "2026-10-07", source: "x", run,
    });
    expect(report.candidates.map((c) => c.id)).toEqual(["non-ofs", "ofs"]);
  });
});
