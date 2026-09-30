/**
 * Garde-fou contre une régression déjà survenue en production : la fiche
 * FINMA promettait des « SRO members » (organismes d'autorégulation, OAR/SRO)
 * qu'aucune archive livrée n'a jamais contenus (catégorie toujours à 0 ligne).
 * Voir docs/internal/audit-global-20260925/sro-20260930/RAPPORT.md, sections 2, 3, 8.3.
 *
 * Ce que ce fichier couvre :
 * 1. La construction réelle de l'archive (buildBundle, à partir d'un uid.csv
 *    synthétique passé par parseUidCsv/entityTypeForAuthorisation, exactement
 *    le chemin de la collecte de production) n'énumère jamais dans le README,
 *    ne livre jamais de fichier finma_<type>.csv, et ne cite jamais dans
 *    l'énumération entity_type du schema.json une catégorie à 0 ligne — le
 *    cœur de la régression d'origine (sro_member listé comme catégorie
 *    possible alors qu'aucune archive n'en a jamais porté une ligne). Ce même
 *    contrôle protège aussi, sans les nommer explicitement, toute catégorie
 *    future qui deviendrait structurellement injoignable de la même façon.
 * 2. Les compteurs affichés en tête de la fiche FINMA (lignes, UID, LEI,
 *    avertissements — copy.rows/uids/leis/warnings dans FinmaProduct.astro)
 *    ne sont pas à zéro dans le dernier instantané connu du dépôt.
 * 3. La fiche FINMA (FR/DE/EN) ne réintroduit pas les textes qui ont causé
 *    l'incident (« SRO members », un compte figé de listes, « DSFI ») et
 *    contient bien la phrase de couverture, avec un lien vers la recherche
 *    officielle de membres OAR de la FINMA.
 *
 * Ce que ce fichier NE couvre PAS :
 * - Il n'appelle aucun service réseau (ni finma.ch, ni l'API du site) : il ne
 *   prouve donc pas que la version actuellement en ligne est correcte, ce
 *   rôle appartient à monitor-public.yml et à une vérification manuelle.
 * - `insurance_intermediary` et `payment_institution` restent dans
 *   FinmaEntityType et FINMA_BUNDLE_ENTITY_TYPES (compatibilité, voies
 *   d'enrichissement futures) ; le contrôle 1 ci-dessus les exclut déjà de
 *   l'énumération livrée dès qu'ils sont absents d'une archive donnée,
 *   comme sro_member, mais ce fichier ne teste pas leur cas nommément.
 * - Il ne parcourt pas toutes les pages publiques du site (`presentation/index.html`
 *   garde encore une mention « 10 listes », hors périmètre de ce correctif).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { buildBundle as buildProductionBundle } from "../../etl/finma/bundle.js";
import { withTestSignature } from "../helpers/signature.js";
import { parseUidCsv } from "../../etl/finma/ingest.js";
import { FINMA_BUNDLE_ENTITY_TYPES } from "../../etl/finma/types.js";
import { AUTH_TYPE_TO_ENTITY_TYPE } from "../../etl/finma/sources.js";

// Catégories que la collecte de production peut un jour produire, quel que
// soit l'échantillon du jour ("other" est le fourre-tout universel de
// entityTypeForAuthorisation). Sert à distinguer, parmi les catégories à 0
// ligne dans UN échantillon donné, celles qui sont juste absentes CE jour-là
// de celles qui ne pourront jamais être produites (le cas sro_member).
const REACHABLE_ENTITY_TYPES = new Set([...Object.values(AUTH_TYPE_TO_ENTITY_TYPE), "other"]);

const buildBundle = withTestSignature(buildProductionBundle);

// Même forme que le uid.csv officiel (Name;City;AuthorisationTypeDE;
// AuthorisationTypeFR;AuthorisationTypeIT;AuthorisationTypeEN;UID), quelques
// libellés réels seulement : le but est de laisser plusieurs catégories à 0,
// comme un vrai instantané où toutes les catégories ne sont pas représentées.
const SYNTHETIC_UID_CSV = [
  "Name;City;AuthorisationTypeDE;AuthorisationTypeFR;AuthorisationTypeIT;AuthorisationTypeEN;UID",
  "Banque Test SA;Genève;Bank;Banque;Banca;Bank;CHE-101.111.111",
  "Gestion Test SA;Zürich;Portfolio manager;Portfolio manager;Portfolio manager;Portfolio manager;CHE-101.222.222",
  "Bourse Test SA;Basel;Wertpapierhaus;Maison de titres;Ditta di valori mobiliari;Securities firm;CHE-101.333.333",
  "Organe Test;Bern;Aufsichtsorganisation;Organisme de surveillance;Organismo di vigilanza;Supervisory organisation;CHE-101.444.444",
].join("\n");

describe("finma coverage promises (régression sro_member)", () => {
  it("le README et les fichiers livrés ne citent jamais une catégorie à 0 ligne", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "osd-finma-coverage-"));
    const csvPath = join(workDir, "uid.csv");
    writeFileSync(csvPath, SYNTHETIC_UID_CSV, "utf8");
    try {
      const entities = parseUidCsv(csvPath);
      // Sanity : le CSV synthétique couvre bien plusieurs catégories et en
      // laisse d'autres à 0, sinon ce test ne démontre rien.
      const present = new Set(entities.map(e => e.entity_type));
      expect(present.size).toBeGreaterThan(0);
      const missing = FINMA_BUNDLE_ENTITY_TYPES.filter(t => !present.has(t));
      expect(missing.length).toBeGreaterThan(0);

      const result = await buildBundle({ entities }, "test-coverage", workDir);
      for (const t of missing) expect(result.countByType[t] ?? 0).toBe(0);

      const contents = execSync(`unzip -l "${result.zipPath}"`, { encoding: "utf8" });
      for (const t of missing) {
        expect(contents, `finma_${t}.csv ne devrait pas être livré (0 ligne)`).not.toContain(`finma_${t}.csv`);
      }

      const readme = execSync(`unzip -p "${result.zipPath}" README.md`, { encoding: "utf8" });
      expect(readme, "le README ne doit jamais annoncer une catégorie à 0 ligne").not.toMatch(/: 0 lignes/);
      for (const t of missing) {
        expect(readme, `${t} ne doit pas apparaître dans la couverture par catégorie`).not.toMatch(new RegExp(`^- ${t} :`, "m"));
      }
      // La phrase de couverture doit être présente dans les trois langues
      // (apostrophe droite ou typographique tolérée pour le français).
      expect(readme).toMatch(/organismes d['’]autorégulation/);
      expect(readme).toMatch(/intermédiaires d['’]assurance/);
      expect(readme).toContain("Selbstregulierungsorganisationen");
      expect(readme).toContain("self-regulatory organisation");

      // Cœur de la régression d'origine : sro_member n'était pas seulement
      // absent des fichiers, il restait listé comme catégorie possible dans
      // le schema.json livré (une promesse, pas une donnée). Parmi les
      // catégories à 0 ligne dans CET échantillon, seules celles qui ne
      // pourront JAMAIS être produites par la collecte de production
      // (structurellement inatteignables, comme l'était sro_member) ne
      // doivent pas figurer dans l'énumération — une catégorie simplement
      // absente aujourd'hui mais atteignable en général (ex. "insurance",
      // absente de ce petit échantillon mais que la collecte peut produire
      // n'importe quel jour) a le droit d'y rester listée.
      const structurallyUnreachable = missing.filter(t => !REACHABLE_ENTITY_TYPES.has(t));
      expect(structurallyUnreachable.length, "cet échantillon doit laisser au moins une catégorie structurellement inatteignable, sinon ce contrôle ne démontre rien").toBeGreaterThan(0);

      const schemaJson = JSON.parse(execSync(`unzip -p "${result.zipPath}" schema.json`, { encoding: "utf8" }));
      const shippedEnum: string[] = schemaJson.items.properties.entity_type.enum;
      for (const t of structurallyUnreachable) {
        expect(shippedEnum, `${t} est structurellement inatteignable et ne doit pas figurer dans l'énumération entity_type du schema.json livré`).not.toContain(t);
      }
      expect(shippedEnum, "sro_member ne doit plus jamais réapparaître dans le schema.json livré").not.toContain("sro_member");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("les compteurs affichés sur la fiche FINMA ne sont pas à zéro dans le dernier instantané connu", () => {
    const status = JSON.parse(readFileSync(join(process.cwd(), "docs/data-status/finma.json"), "utf8"));
    // Ces quatre nombres sont exactement ceux que FinmaProduct.astro affiche
    // sous copy.rows / copy.uids / copy.leis / copy.warnings.
    expect(status.registry_rows, "registry_rows (lignes du registre)").toBeGreaterThan(0);
    expect(status.unique_uids, "unique_uids (UID distincts)").toBeGreaterThan(0);
    expect(status.populated_fields?.lei, "populated_fields.lei (lignes avec un LEI)").toBeGreaterThan(0);
    expect(status.warning_rows, "warning_rows (avertissements séparés)").toBeGreaterThan(0);
  });

  it("la fiche FINMA (FR/DE/EN) ne réintroduit pas la promesse SRO retirée et garde sa phrase de couverture", () => {
    const source = readFileSync(join(process.cwd(), "web/src/components/FinmaProduct.astro"), "utf8");
    for (const pattern of [/SRO members/, /SRO-Mitglieder(?!-Suche)/, /\b10 (listes|lists|Listen)\b/i, /\bDSFI\b/, /sro_member/]) {
      expect(source, String(pattern)).not.toMatch(pattern);
    }
    // Phrase de couverture (une par langue) et lien vers la recherche
    // officielle de membres OAR de la FINMA (SOURCES['finma-oar']).
    expect(source).toMatch(/organismes d['’]autorégulation/);
    expect(source).toContain("self-regulatory organisation (SRO)");
    expect(source).toContain("Selbstregulierungsorganisationen (SRO");
    expect(source).toContain("SOURCES['finma-oar']");
  });
});
