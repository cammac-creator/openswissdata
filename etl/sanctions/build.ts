/**
 * Du fichier lu au document écrit, et le contrôle qui prouve l'exclusion des personnes.
 *
 * Étage lu : rendu de `parse.ts`, en mémoire. Étage écrit : rien ici ; `collect.ts` écrit le
 * document rendu par `buildSanctionsDocument`.
 *
 * Le contrôle relit le document FINI, pas l'intention du code : une clé hors de la liste blanche,
 * un genre inconnu ou un nom d'organisation pris par la règle des personnes et non gardé après
 * relecture arrêtent tout. Les noms gardés après relecture sont comptés à part. La preuve publiée
 * vient de ce comptage ; elle ne dit rien des noms que la règle ne voit pas (`SOURCES.md`).
 */
import {
  SANCTIONS_SCHEMA,
  SANCTIONS_SOURCE_ID,
  type SanctionsDocument,
} from "../../src/lib/sanctions.js";
import { organisationNameIsWithheld, type ParsedSesam } from "./parse.js";

const ENTRY_KEYS = new Set(["id", "kind", "names", "programmes", "listed_on", "countries", "imo"]);
const NAME_KEYS = new Set(["type", "value"]);
const PROGRAMME_KEYS = new Set(["id", "name", "origin"]);

/** Planchers et baisse tolérée : en dessous, on regarde avant de servir. Mesures du 04.11.2026 : 2 872 et 708. */
export const MIN_ORGANISATIONS = 2_000;
export const MIN_VESSELS = 400;
export const MAX_DROP_RATIO = 0.15;
export const MAX_VESSELS_WITHOUT_IMO_RATIO = 0.05;
/**
 * La date du fichier n'est pas celle du jour : relevé le 05.11.2026 après minuit, même empreinte et
 * même date que la veille. Une liste qui ne change pas reste donc juste ; seule une date qui recule
 * ou qui n'a aucun sens arrête. La fraîcheur se mesure sur le dernier relevé réussi (`collected_at`).
 */
export const MAX_LIST_AGE_DAYS = 400;

export class SanctionsControlError extends Error {
  constructor(reason: string) {
    super(`Collecte des sanctions arrêtée (${reason})`);
    this.name = "SanctionsControlError";
  }
}

function assertOnlyKeys(value: object, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new SanctionsControlError(`champ non prévu dans ${where}`);
  }
}

export function buildSanctionsDocument(
  parsed: ParsedSesam,
  source: { sha256: string; bytes: number; collectedAt: string },
): SanctionsDocument {
  let organisations = 0;
  let vessels = 0;
  let organisationNamesCarryingPerson = 0;
  for (const entry of parsed.entries) {
    assertOnlyKeys(entry, ENTRY_KEYS, "une entrée");
    for (const name of entry.names) assertOnlyKeys(name, NAME_KEYS, "un nom");
    for (const programme of entry.programmes) assertOnlyKeys(programme, PROGRAMME_KEYS, "un programme");
    if (entry.kind === "organisation") {
      organisations++;
      organisationNamesCarryingPerson += entry.names.filter((n) => organisationNameIsWithheld(n.value, parsed.personIndex)).length;
    } else if (entry.kind === "vessel") {
      vessels++;
    } else {
      throw new SanctionsControlError("genre inconnu");
    }
  }
  if (organisationNamesCarryingPerson !== 0) throw new SanctionsControlError("nom de personne sur une organisation");
  return {
    schema: SANCTIONS_SCHEMA,
    source_id: SANCTIONS_SOURCE_ID,
    list_date: parsed.listDate,
    source_sha256: source.sha256,
    source_bytes: source.bytes,
    collected_at: source.collectedAt,
    counts: { organisations, vessels },
    vessels_without_imo: parsed.vesselsWithoutImo,
    exclusion_proof: {
      source_entries: parsed.sourceEntries,
      excluded: parsed.excluded,
      organisation_names_removed_carrying_person: parsed.organisationNamesRemovedCarryingPerson,
      vessels_name_equals_person_entry: parsed.vesselsNameEqualsPerson,
      organisation_names_honouring_a_person_kept: parsed.organisationNamesHonouringAPersonKept,
      organisation_names_kept_after_review: parsed.organisationNamesKeptAfterReview,
      // Chaque entrée écrite est « organisation » ou « bateau », et aucune clé hors liste blanche
      // ne passe le contrôle ci-dessus : ces trois zéros sont mesurés, pas déclarés.
      natural_persons_served: parsed.entries.length - organisations - vessels,
      relations_served: parsed.entries.filter((e) => "relation" in e).length,
      free_text_fields_served: parsed.entries.filter((e) => "justification" in e || "other_information" in e).length,
      organisation_names_caught_and_not_reviewed_served: organisationNamesCarryingPerson,
    },
    entries: parsed.entries,
  };
}

/** Contrôles avant toute écriture. `previous` : comptes de la version servie, `null` à la première collecte. */
export function checkSanctionsDocument(
  doc: SanctionsDocument,
  opts: { now: number; previous: { organisations: number; vessels: number; list_date: string } | null; acceptDrop: boolean },
): void {
  const age = (opts.now - Date.parse(`${doc.list_date}T00:00:00Z`)) / 86_400_000;
  if (age > MAX_LIST_AGE_DAYS || age < -1) throw new SanctionsControlError("date de la liste inattendue");
  if (opts.previous && doc.list_date < opts.previous.list_date) throw new SanctionsControlError("date de la liste qui recule");
  if (doc.counts.organisations < MIN_ORGANISATIONS) throw new SanctionsControlError("trop peu d'organisations");
  if (doc.counts.vessels < MIN_VESSELS) throw new SanctionsControlError("trop peu de bateaux");
  if (doc.vessels_without_imo > doc.counts.vessels * MAX_VESSELS_WITHOUT_IMO_RATIO) throw new SanctionsControlError("trop de bateaux sans numéro IMO");
  const proof = doc.exclusion_proof;
  if (proof.source_entries.natural_persons !== proof.excluded.natural_persons) throw new SanctionsControlError("personnes non écartées");
  if (proof.natural_persons_served !== 0) throw new SanctionsControlError("personne servie");
  if (opts.previous && !opts.acceptDrop) {
    const dropped = (now: number, before: number) => before > 0 && (before - now) / before > MAX_DROP_RATIO;
    if (dropped(doc.counts.organisations, opts.previous.organisations) || dropped(doc.counts.vessels, opts.previous.vessels)) {
      throw new SanctionsControlError("baisse inhabituelle du volume");
    }
  }
}
