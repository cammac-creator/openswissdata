/**
 * Assembleur de la fiche de vérification d'une société suisse (tâche osd.fiche, tâche 4).
 *
 * Combine en mémoire trois sources déjà lues ailleurs — registre du commerce en données
 * liées (`lindas.ts`), registre FINMA (`../data-loader.ts`, copie embarquée au déploiement
 * ou rafraîchie par `r2-refresh.ts`) et GLEIF (`gleif.ts`) — en une fiche de FAITS datés et
 * sourcés. Les `cross_checks` sont des recoupements EXACTS (égalité après normalisation du
 * nom, appartenance pour un LEI) : jamais une note, un score ou un verdict. `companyCheck`
 * est le seul point d'entrée réseau ; `buildCompanyFiche` est un assemblage pur, sans
 * aucun accès réseau ni disque, pour rester facile à tester et à faire évoluer séparément.
 */

import { parseUid } from "./uid.js";
import { lookupLindas } from "./lindas.js";
import { lookupGleif } from "./gleif.js";
import { COMPANY_SOURCES } from "./sources.js";
import { getFinmaRegistry, getFinmaVersion, type FinmaRegistryRow } from "../data-loader.js";
import type { GleifRecord, LindasCompany, LiveDeps, Part } from "./types.js";

export interface Fact {
  field: string;
  value: string | boolean | null;
  source_id: string;
  source_url: string;
  retrieved_at: string;
}

export interface CrossCheck {
  check: string;
  sources: string[];
  result: boolean;
  detail: string;
}

export interface CompanyFiche {
  uid: string;
  generated_at: string;
  commercial_register: { available: boolean; found: boolean; reason?: string; facts: Fact[] };
  // `data_note` (tâche osd.fiche, tâche 4) : les faits FINMA viennent de la dernière
  // collecte du service, jamais d'une lecture en direct. `retrieved_at` de chaque Fact
  // FINMA reste toujours `generated_at` (la version FINMA, ex. "2026.10.06", n'est pas une
  // date ISO : on ne la met jamais dans un champ daté) ; `data_note` la mentionne quand
  // elle est connue.
  finma: { found: boolean; facts: Fact[]; warning_list: "not_checkable_by_uid"; data_note: string };
  lei: { available: boolean; found: boolean; reason?: string; facts: Fact[] };
  cross_checks: CrossCheck[];
  // Ce que la fiche ne dit PAS : statut d'inscription au registre, publications FOSC,
  // sanctions SECO, organes. Toujours ces quatre valeurs, dans cet ordre (tâche osd.fiche).
  not_covered: string[];
  notice: string;
}

const NOT_COVERED = ["registration_status", "fosc_publications", "seco_sanctions", "officers"] as const;

const NOTICE =
  "Unofficial copy assembled from public sources. Check the official registers before any decision: zefix.admin.ch, finma.ch, search.gleif.org.";

// Entreprise individuelle (Zefix eCH-0097) : forme juridique "0101". L'adresse privée du
// titulaire n'est jamais reprise dans la fiche ; commune et canton restent (décision du
// 06.10.2026, tâche osd.fiche).
const INDIVIDUAL_ENTERPRISE_FORM_CODE = "0101";

/** NFC, espaces consécutifs réduits à un, bords rognés ; casse et ponctuation conservées. */
function normalizeName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

function pushIfPresent(facts: Fact[], field: string, value: string | null | undefined, sourceId: string, sourceUrl: string, retrievedAt: string): void {
  if (value !== null && value !== undefined && value !== "") {
    facts.push({ field, value, source_id: sourceId, source_url: sourceUrl, retrieved_at: retrievedAt });
  }
}

/** Un `Fact` par champ non nul de `LindasCompany` ; `other_names` (tableau) est joint en une
 *  seule chaîne pour rester compatible avec `Fact.value`. Entreprise individuelle (0101) :
 *  `street_address`, `postal_code` et `locality` sont retirés, commune et canton gardés. */
function lindasFacts(data: LindasCompany, retrievedAt: string): Fact[] {
  const sourceId = "ofrc.zefix_lindas";
  const sourceUrl = COMPANY_SOURCES[sourceId].url;
  const isIndividualEnterprise = data.legal_form_code === INDIVIDUAL_ENTERPRISE_FORM_CODE;
  const facts: Fact[] = [];
  const add = (field: string, value: string | null) => pushIfPresent(facts, field, value, sourceId, sourceUrl, retrievedAt);

  add("legal_name", data.legal_name);
  if (data.other_names.length > 0) add("other_names", data.other_names.join("; "));
  add("legal_form_code", data.legal_form_code);
  add("legal_form_label_fr", data.legal_form_label_fr);
  add("legal_form_label_de", data.legal_form_label_de);
  add("municipality", data.municipality);
  add("municipality_bfs_id", data.municipality_bfs_id);
  add("canton", data.canton);
  if (!isIndividualEnterprise) {
    add("street_address", data.street_address);
    add("postal_code", data.postal_code);
    add("locality", data.locality);
  }
  add("purpose", data.purpose);
  add("ch_id", data.ch_id);
  add("register_uri", data.register_uri);
  return facts;
}

/** Un groupe de faits par enregistrement GLEIF ; `source_url` propre à chaque LEI. */
function gleifFacts(records: readonly GleifRecord[], retrievedAt: string): Fact[] {
  const sourceId = "gleif.lei_api";
  const facts: Fact[] = [];
  for (const record of records) {
    const sourceUrl = `https://search.gleif.org/#/record/${record.lei}`;
    const add = (field: string, value: string | null) => pushIfPresent(facts, field, value, sourceId, sourceUrl, retrievedAt);
    add("lei", record.lei);
    add("legal_name", record.legal_name);
    add("entity_status", record.entity_status);
    add("registration_status", record.registration_status);
    add("last_update", record.last_update);
    add("registered_as", record.registered_as);
  }
  return facts;
}

/** `licence_type`, `status`, `licence_date`, `lei` (si non vide) pour chaque ligne FINMA
 *  dont l'IDE est exactement celui demandé (plusieurs lignes possibles, une par
 *  autorisation). `source_url` vient de la ligne elle-même, jamais de la table locale. */
function finmaFacts(rows: readonly FinmaRegistryRow[], retrievedAt: string): Fact[] {
  const sourceId = "finma.uid_csv";
  const fallbackUrl = COMPANY_SOURCES[sourceId].url;
  const facts: Fact[] = [];
  for (const row of rows) {
    const sourceUrl = row.source_url || fallbackUrl;
    const add = (field: string, value: string) => pushIfPresent(facts, field, value, sourceId, sourceUrl, retrievedAt);
    add("licence_type", row.licence_type);
    add("status", row.status);
    add("licence_date", row.licence_date);
    add("lei", row.lei);
  }
  return facts;
}

export function buildCompanyFiche(
  uid: string,
  parts: {
    lindas: Part<LindasCompany>;
    gleif: Part<GleifRecord[]>;
    finma: readonly FinmaRegistryRow[];
    /**
     * Version des données FINMA actuellement servies (`getFinmaVersion()`), lue par
     * l'appelant SEULEMENT quand `parts.finma` vient du registre par défaut (voir
     * `companyCheck`) : un registre FINMA injecté en test n'a pas de version connue
     * correspondante, et lire une horloge globale ici romprait l'assemblage pur de cette
     * fonction. Absente ou `null` : aucune version connue, seulement mentionné dans
     * `finma.data_note` via le texte par défaut.
     */
    finmaVersion?: string | null;
    now: () => number;
  },
): CompanyFiche {
  const generatedAt = new Date(parts.now()).toISOString();

  const commercial_register: CompanyFiche["commercial_register"] = parts.lindas.available
    ? parts.lindas.found && parts.lindas.data
      ? { available: true, found: true, facts: lindasFacts(parts.lindas.data, parts.lindas.retrieved_at) }
      : { available: true, found: false, facts: [] }
    : { available: false, found: false, reason: parts.lindas.reason, facts: [] };

  const lei: CompanyFiche["lei"] = parts.gleif.available
    ? parts.gleif.found && parts.gleif.data
      ? { available: true, found: true, facts: gleifFacts(parts.gleif.data, parts.gleif.retrieved_at) }
      : { available: true, found: false, facts: [] }
    : { available: false, found: false, reason: parts.gleif.reason, facts: [] };

  // Toutes les lignes FINMA dont l'IDE est EXACTEMENT celui demandé (égalité de chaîne sur
  // la forme canonique CHE-xxx.xxx.xxx : `uid` ici et dans la colonne du CSV sont déjà
  // sous cette forme — 103 IDE portent 2 ou 3 lignes, une par autorisation).
  const finmaRows = parts.finma.filter((row) => row.uid === uid);

  // La date de collecte des lignes FINMA chargées en mémoire n'est pas connue ici (pas de
  // lecture en direct) : chaque Fact FINMA porte toujours `generated_at` comme
  // `retrieved_at`. `parts.finmaVersion` (ex. "2026.10.06", pas une date ISO) n'est
  // mentionnée que dans `data_note`, jamais posée dans un champ daté.
  const finmaDataNote = parts.finmaVersion
    ? `FINMA facts reflect the data version "${parts.finmaVersion}" currently served by this service, not a live read of the FINMA register.`
    : "FINMA facts reflect this service's last scheduled FINMA collection, not a live read of the FINMA register.";

  const finma: CompanyFiche["finma"] = {
    found: finmaRows.length > 0,
    facts: finmaFacts(finmaRows, generatedAt),
    warning_list: "not_checkable_by_uid",
    data_note: finmaDataNote,
  };

  const lindasData = commercial_register.found && parts.lindas.available ? parts.lindas.data : null;
  const gleifRecords = lei.found && parts.gleif.available && parts.gleif.data ? parts.gleif.data : [];

  // Recoupements : des FAITS (jamais un verdict), uniquement quand les deux côtés
  // existent réellement (source disponible ET trouvée).
  const cross_checks: CrossCheck[] = [];

  if (lindasData) {
    for (const record of gleifRecords) {
      cross_checks.push({
        check: "legal_name_lindas_vs_gleif",
        sources: ["ofrc.zefix_lindas", "gleif.lei_api"],
        result: namesMatch(lindasData.legal_name, record.legal_name),
        detail: `LINDAS legal name "${lindasData.legal_name}" vs GLEIF legal name "${record.legal_name}" (LEI ${record.lei})`,
      });
    }
  }

  // Plusieurs lignes FINMA pour le même IDE (une par autorisation) répètent souvent le
  // même `lei` ou le même `name` : un recoupement par VALEUR DISTINCTE, jamais un par
  // ligne, pour ne pas dupliquer un même fait de comparaison.
  if (gleifRecords.length > 0) {
    const gleifLeis = gleifRecords.map((r) => r.lei);
    const seenLeis = new Set<string>();
    for (const row of finmaRows) {
      if (row.lei !== "" && !seenLeis.has(row.lei)) {
        seenLeis.add(row.lei);
        cross_checks.push({
          check: "finma_lei_vs_gleif_lei",
          sources: ["finma.uid_csv", "gleif.lei_api"],
          result: gleifLeis.includes(row.lei),
          detail: `FINMA lei "${row.lei}" vs GLEIF lei(s) "${gleifLeis.join(", ")}"`,
        });
      }
    }
  }

  if (lindasData) {
    const seenNames = new Set<string>();
    for (const row of finmaRows) {
      if (row.name !== "" && !seenNames.has(row.name)) {
        seenNames.add(row.name);
        cross_checks.push({
          check: "finma_name_vs_lindas_legal_name",
          sources: ["finma.uid_csv", "ofrc.zefix_lindas"],
          result: namesMatch(row.name, lindasData.legal_name),
          detail: `FINMA name "${row.name}" vs LINDAS legal name "${lindasData.legal_name}"`,
        });
      }
    }
  }

  return {
    uid,
    generated_at: generatedAt,
    commercial_register,
    finma,
    lei,
    cross_checks,
    not_covered: [...NOT_COVERED],
    notice: NOTICE,
  };
}

export async function companyCheck(
  rawUid: string,
  deps: LiveDeps & { finma?: () => readonly FinmaRegistryRow[] },
): Promise<{ ok: true; fiche: CompanyFiche } | { ok: false; reason: string }> {
  const parsed = parseUid(rawUid);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const [lindas, gleif] = await Promise.all([lookupLindas(parsed.compact, deps), lookupGleif(parsed.uid, deps)]);
  // `getFinmaVersion()` n'est lue que lorsque le registre par défaut est utilisé : un
  // registre FINMA injecté (tests, ou tout autre appelant) n'a pas de version connue
  // correspondante (voir le commentaire sur `parts.finmaVersion` dans `buildCompanyFiche`).
  const usingDefaultFinmaRegistry = deps.finma === undefined;
  const finmaRows = (deps.finma ?? getFinmaRegistry)();
  const finmaVersion = usingDefaultFinmaRegistry ? getFinmaVersion() : null;
  const fiche = buildCompanyFiche(parsed.uid, { lindas, gleif, finma: finmaRows, finmaVersion, now: deps.now });
  return { ok: true, fiche };
}
