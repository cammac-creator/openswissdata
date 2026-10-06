import { datasetLicense } from "../shared/dataset-license.js";
import { mkdirSync, rmSync, existsSync, createWriteStream, readFileSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import XLSX from "../shared/xlsx.js";
import { createHash } from "node:crypto";
import parquet from "parquetjs-lite";
import { writeCsv, writeJson, writeSqlInserts, writeParquet } from "../shared/formats.js";
import { buildSignedProvenance, type ProvenanceFile, type SignProvenanceOptions } from "../shared/provenance.js";
import { PRODUCT_SOURCES, provenanceFieldsFor } from "../shared/sources/products.js";
import { SOURCES } from "../shared/sources/registry.js";
import type { FinmaEntity, FinmaEntityType, FinmaReferenceOrganisation, FinmaSourceFileMeta, FinmaWarning } from "./types.js";
import type { SupervisionMatchStats } from "./ingest-supervision.js";
import { FINMA_BUNDLE_ENTITY_TYPES } from "./types.js";
import { AUTH_TYPE_TO_ENTITY_TYPE } from "./sources.js";
import type { ZefixData } from "./ingest-zefix.js";
import type { DeltaChange } from "./delta.js";

const FINMA_PARQUET_SCHEMA = new parquet.ParquetSchema({
  entity_type: { type: "UTF8" },
  name: { type: "UTF8" },
  uid: { type: "UTF8", optional: true },
  lei: { type: "UTF8", optional: true },
  lei_source_url: { type: "UTF8", optional: true },
  lei_registration_status: { type: "UTF8", optional: true },
  lei_updated_at: { type: "UTF8", optional: true },
  address_source_url: { type: "UTF8", optional: true },
  licence_type: { type: "UTF8", optional: true },
  licence_type_de: { type: "UTF8", optional: true },
  licence_type_fr: { type: "UTF8", optional: true },
  licence_type_it: { type: "UTF8", optional: true },
  licence_date: { type: "UTF8", optional: true },
  status: { type: "UTF8", optional: true },
  canton: { type: "UTF8", optional: true },
  city: { type: "UTF8", optional: true },
  address: { type: "UTF8", optional: true },
  source_list: { type: "UTF8" },
  source_url: { type: "UTF8" },
  is_warning_listed: { type: "BOOLEAN", optional: true },
  supervisory_organisation: { type: "UTF8", optional: true },
  supervisory_organisation_source_url: { type: "UTF8", optional: true },
  supervisory_organisation_observed_on: { type: "UTF8", optional: true },
});

// Tables de référence (institutions uniquement, sans e-mail ni téléphone).
const FINMA_REFERENCE_SROS_PARQUET_SCHEMA = new parquet.ParquetSchema({
  name: { type: "UTF8" },
  address: { type: "UTF8" },
  website: { type: "UTF8", optional: true },
  source_url: { type: "UTF8" },
  observed_on: { type: "UTF8" },
});

const FINMA_REFERENCE_SO_PARQUET_SCHEMA = new parquet.ParquetSchema({
  name: { type: "UTF8" },
  address: { type: "UTF8" },
  city: { type: "UTF8" },
  website: { type: "UTF8", optional: true },
  source_url: { type: "UTF8" },
  observed_on: { type: "UTF8" },
});

const FINMA_WARNINGS_PARQUET_SCHEMA = new parquet.ParquetSchema({
  name: { type: "UTF8" },
  country: { type: "UTF8", optional: true },
  date_added: { type: "UTF8", optional: true },
  category: { type: "UTF8", optional: true },
  source_url: { type: "UTF8" },
  source_list: { type: "UTF8" },
  warning_type: { type: "UTF8" },
  additional_info: { type: "UTF8", optional: true },
});

// Zefix-enriched FINMA registry — adds 7 columns. Note: nested arrays/structs
// are flaky in parquetjs-lite, so `zefix_organes` is JSON-stringified and
// stored as UTF8 (consistent across CSV/SQL/JSON/Parquet for v1).
const FINMA_WITH_ZEFIX_PARQUET_SCHEMA = new parquet.ParquetSchema({
  entity_type: { type: "UTF8" },
  name: { type: "UTF8" },
  uid: { type: "UTF8", optional: true },
  lei: { type: "UTF8", optional: true },
  lei_source_url: { type: "UTF8", optional: true },
  lei_registration_status: { type: "UTF8", optional: true },
  lei_updated_at: { type: "UTF8", optional: true },
  address_source_url: { type: "UTF8", optional: true },
  licence_type: { type: "UTF8", optional: true },
  licence_type_de: { type: "UTF8", optional: true },
  licence_type_fr: { type: "UTF8", optional: true },
  licence_type_it: { type: "UTF8", optional: true },
  licence_date: { type: "UTF8", optional: true },
  status: { type: "UTF8", optional: true },
  canton: { type: "UTF8", optional: true },
  city: { type: "UTF8", optional: true },
  address: { type: "UTF8", optional: true },
  source_list: { type: "UTF8" },
  source_url: { type: "UTF8" },
  is_warning_listed: { type: "BOOLEAN", optional: true },
  supervisory_organisation: { type: "UTF8", optional: true },
  supervisory_organisation_source_url: { type: "UTF8", optional: true },
  supervisory_organisation_observed_on: { type: "UTF8", optional: true },
  zefix_status: { type: "UTF8", optional: true },
  zefix_capital: { type: "DOUBLE", optional: true },
  zefix_capital_currency: { type: "UTF8", optional: true },
  zefix_legal_form: { type: "UTF8", optional: true },
  zefix_legal_form_code: { type: "UTF8", optional: true },
  zefix_purpose: { type: "UTF8", optional: true },
  zefix_organes: { type: "UTF8", optional: true },
  zefix_last_update: { type: "UTF8", optional: true },
  zefix_id: { type: "UTF8", optional: true },
});

const DATASET_LICENSE = datasetLicense("finma");

// Mêmes adresses que web/src/lib/guides.ts (SOURCES['finma-oar'].url).
// Le README reste rédigé en français ; la phrase de couverture est
// répétée en allemand et en anglais (voir plus bas) pour un acheteur qui
// n'a lu que la fiche produit dans une de ces deux langues.
const FINMA_OAR_SEARCH_URL_FR =
  "https://www.finma.ch/fr/autorisation/organisme-d-autoregulation-oar/recherche-de-membres-oar/";
const FINMA_OAR_SEARCH_URL_DE =
  "https://www.finma.ch/de/bewilligung/selbstregulierungsorganisationen-sro/sro-mitglieder-suche/";
const FINMA_OAR_SEARCH_URL_EN =
  "https://www.finma.ch/en/authorisation/self-regulatory-organisations-sros/sro-member-search/";

// Organisme de surveillance (OS, LEFin) : ne jamais le présenter comme une
// affiliation à un OAR (LBA). Textes repris dans quality.json, le classeur et le README.
const SUPERVISION_MEANING =
  "Organisme de surveillance (OS) qui surveille le gestionnaire de fortune ou le trustee selon la loi sur les établissements financiers (LEFin), d'après la liste officielle de la FINMA. Ce n'est pas une affiliation à un organisme d'autorégulation (OAR, loi sur le blanchiment d'argent).";
const SUPERVISION_MATCHING =
  "Rapprochement par nom et localité identiques (Unicode NFC et espaces normalisés ; casse, ponctuation et forme juridique conservées), seulement si la correspondance est unique dans la liste FINMA, porte un seul UID et le même type d'autorisation. Sinon le champ reste vide : un champ vide ne dit pas si l'établissement a un organisme de surveillance.";
const REFERENCE_TABLES_NOTE =
  "Listes FINMA des organismes d'autorégulation (OAR) reconnus et des organismes de surveillance (OS) autorisés : raison sociale, adresse et site, tels que publiés. Ce sont des institutions ; la liste de leurs membres ou affiliés n'est pas incluse. Les adresses e-mail et numéros de téléphone ne sont pas repris.";

export interface FinmaBundleInput {
  entities: FinmaEntity[];
  warnings?: FinmaWarning[];
  recentChanges?: DeltaChange[]; // Historique réellement observé.
  historyCoverage?: Record<string, unknown>;
  /** Tier "FINMA + Zefix Sync": Zefix data keyed by FINMA UID. Optional. */
  zefixByUid?: Map<string, ZefixData>;
  /**
   * Organisme de surveillance (déjà rattaché aux entités) et tables de
   * référence des OAR et des OS. Obligatoire pour la collecte de production
   * (release.ts) ; absent des archives de fixtures.
   */
  supervision?: FinmaSupervisionBundleInput;
}

export interface FinmaSupervisionBundleInput {
  sros: FinmaReferenceOrganisation[];
  supervisoryOrganisations: FinmaReferenceOrganisation[];
  matching: SupervisionMatchStats;
  sources: { vvtr: FinmaSourceFileMeta; sro: FinmaSourceFileMeta; ao: FinmaSourceFileMeta };
}

export interface FinmaBundleResult {
  zipPath: string;
  sha256: string;
  sizeBytes: number;
  version: string;
  entityCount: number;
  countByType: Record<FinmaEntityType, number>;
  changeCount: number;
  warningCount: number;
  warningListedFlagCount: number;
  /** Number of FINMA entities enriched with Zefix data (0 if tier=standard). */
  zefixEnrichedCount: number;
  /** Lignes du registre portant un organisme de surveillance (LEFin). */
  supervisoryOrganisationRowCount: number;
  /** Lignes des tables de référence livrées (0 si absentes de l'archive). */
  referenceSroCount: number;
  referenceSupervisoryOrganisationCount: number;
}

function toCsvRow(e: FinmaEntity): Record<string, unknown> {
  return {
    entity_type: e.entity_type,
    name: e.name,
    uid: e.uid ?? "",
    lei: e.lei ?? "",
    lei_source_url: e.lei_source_url ?? "",
    lei_registration_status: e.lei_registration_status ?? "",
    lei_updated_at: e.lei_updated_at ?? "",
    address_source_url: e.address_source_url ?? "",
    licence_type: e.licence_type ?? "",
    licence_type_de: e.licence_type_de ?? "",
    licence_type_fr: e.licence_type_fr ?? "",
    licence_type_it: e.licence_type_it ?? "",
    licence_date: e.licence_date ?? "",
    status: e.status ?? "",
    canton: e.canton ?? "",
    city: e.city ?? "",
    address: e.address ?? "",
    source_list: e.source_list,
    source_url: e.source_url,
    is_warning_listed: typeof e.is_warning_listed === "boolean" ? String(e.is_warning_listed) : "",
    supervisory_organisation: e.supervisory_organisation ?? "",
    supervisory_organisation_source_url: e.supervisory_organisation_source_url ?? "",
    supervisory_organisation_observed_on: e.supervisory_organisation_observed_on ?? "",
  };
}

function referenceToCsvRow(o: FinmaReferenceOrganisation, withCity: boolean): Record<string, unknown> {
  return {
    name: o.name,
    address: o.address,
    ...(withCity ? { city: o.city ?? "" } : {}),
    website: o.website ?? "",
    source_url: o.source_url,
    observed_on: o.observed_on,
  };
}

function warningToCsvRow(w: FinmaWarning): Record<string, unknown> {
  return {
    name: w.name,
    country: w.country ?? "",
    date_added: w.date_added ?? "",
    category: w.category ?? "",
    source_url: w.source_url,
    source_list: w.source_list,
    warning_type: w.warning_type,
    additional_info: w.additional_info ?? "",
  };
}

function deltaToCsvRow(c: DeltaChange): Record<string, unknown> {
  return {
    observed_at: c.observed_at ?? "",
    previous_version: c.previous_version ?? "",
    version: c.version ?? "",
    kind: c.kind,
    entity_type: c.entity_type,
    name: c.name,
    uid: c.uid ?? "",
    source_list: c.source_list,
    before: c.before ? JSON.stringify(c.before) : "",
    after: c.after ? JSON.stringify(c.after) : "",
  };
}

export interface FinmaBuildBundleOptions {
  /** Skip the RFC-3161 timestamp call (used in offline tests). */
  withTimestamp?: boolean;
  /** Injection explicite pour les tests ; les collectes ne passent pas cette option. */
  signing?: SignProvenanceOptions;
}

export async function buildBundle(
  input: FinmaBundleInput,
  version: string,
  outDir: string,
  opts: FinmaBuildBundleOptions = {},
): Promise<FinmaBundleResult> {
  // Une table promise ne doit jamais partir vide (même garde-fou que C4).
  const supervision = input.supervision;
  const supervisoryOrganisationRowCount = input.entities.filter(e => e.supervisory_organisation).length;
  if (supervision) {
    if (!supervision.sros.length || !supervision.supervisoryOrganisations.length) {
      throw new Error("Table de référence FINMA vide : publication annulée");
    }
    if (supervisoryOrganisationRowCount === 0) {
      throw new Error("Aucun organisme de surveillance rattaché au registre : publication annulée");
    }
  }

  // Garde-fou (resserre, tâche osd.socle) : des données Zefix dans l'archive sans
  // source Zefix déclarée au registre ET dans la liste du produit FINMA signifierait
  // un manifeste de provenance qui tait une source réellement assemblée. Aucun
  // workflow n'active aujourd'hui ce tier (FINMA_TIER=zefix) : ce garde-fou ne change
  // rien à la production actuelle, il bloque seulement une future activation non préparée.
  // Même condition que `includeZefix` plus bas : dès que `zefixByUid` est fourni, les colonnes
  // zefix_* entrent dans le schéma de l'archive, même vides.
  if (input.zefixByUid !== undefined) {
    const sourceAuRegistre = SOURCES.some(s => /zefix/i.test(s.id));
    const sourceAuProduit = PRODUCT_SOURCES.finma.some(id => /zefix/i.test(id));
    if (!sourceAuRegistre || !sourceAuProduit) {
      // Message corrigé le 06.10.2026 (relecture finale, tâche osd.fiche) : l'ancien texte
      // disait « aucune source Zefix au registre », ce qui n'est plus exact depuis que le
      // registre PEUT porter une source Zefix sans qu'elle soit déclarée dans la liste du
      // produit FINMA — c'est cette dernière déclaration qui manque réellement ici. La
      // sous-chaîne « données Zefix présentes mais aucune source Zefix au registre » reste
      // intacte : `tests/etl/finma-zefix-guard.test.ts` (sur main, jamais modifié) la vérifie.
      throw new Error(
        "provenance FINMA : données Zefix présentes mais aucune source Zefix au registre des sources de l'archive FINMA ; déclarer la source dans PRODUCT_SOURCES.finma avec sa licence avant de publier"
      );
    }
  }

  const workDir = join(outDir, `finma-${version}-work`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const countByType = {} as Record<FinmaEntityType, number>;
  const entityTypes: FinmaEntityType[] = FINMA_BUNDLE_ENTITY_TYPES;
  for (const t of entityTypes) countByType[t] = 0;
  for (const e of input.entities) countByType[e.entity_type] = (countByType[e.entity_type] ?? 0) + 1;
  const warningListedFlagCount = input.entities.reduce((acc, e) => acc + (e.is_warning_listed ? 1 : 0), 0);

  // Unified registry in 4 formats
  const csvRows = input.entities.map(toCsvRow);
  writeCsv(csvRows, join(workDir, "finma_registry.csv"));
  writeJson(input.entities, join(workDir, "finma_registry.json"));
  writeSqlInserts("finma_registry", csvRows, join(workDir, "finma_registry.sql"));
  const parquetRows = input.entities.map(e => ({
    entity_type: e.entity_type,
    name: e.name,
    uid: e.uid,
    lei: e.lei,
    lei_source_url: e.lei_source_url,
    lei_registration_status: e.lei_registration_status,
    lei_updated_at: e.lei_updated_at,
    address_source_url: e.address_source_url,
    licence_type: e.licence_type,
    licence_type_de: e.licence_type_de,
    licence_type_fr: e.licence_type_fr,
    licence_type_it: e.licence_type_it,
    licence_date: e.licence_date,
    status: e.status,
    canton: e.canton,
    city: e.city,
    address: e.address,
    source_list: e.source_list,
    source_url: e.source_url,
    is_warning_listed: e.is_warning_listed ?? undefined,
    supervisory_organisation: e.supervisory_organisation,
    supervisory_organisation_source_url: e.supervisory_organisation_source_url,
    supervisory_organisation_observed_on: e.supervisory_organisation_observed_on,
  }));
  await writeParquet(parquetRows as Record<string, unknown>[], FINMA_PARQUET_SCHEMA, join(workDir, "finma_registry.parquet"));

  // Per-type CSV files for granular consumption (registry only — warnings
  // are a separate, parallel dataset and never enter this loop).
  for (const t of entityTypes) {
    const filtered = csvRows.filter(r => r.entity_type === t);
    if (filtered.length > 0) {
      writeCsv(filtered, join(workDir, `finma_${t}.csv`));
    }
  }

  // Tier "FINMA + Zefix Sync" — enriched registry (only if zefixByUid provided).
  const zefixByUid = input.zefixByUid;
  let zefixEnrichedCount = 0;
  const includeZefix = zefixByUid !== undefined;
  if (includeZefix) {
    const enriched = input.entities.map((e) => {
      const z = e.uid ? zefixByUid!.get(e.uid) : undefined;
      if (z) zefixEnrichedCount++;
      return {
        ...e,
        zefix_status: z?.status,
        zefix_capital: z?.capital,
        zefix_capital_currency: z?.capital_currency,
        zefix_legal_form: z?.legal_form,
        zefix_legal_form_code: z?.legal_form_code,
        zefix_purpose: z?.purpose,
        zefix_organes: z?.organes,
        zefix_last_update: z?.last_update,
        zefix_id: z?.zefix_id,
      };
    });

    const enrichedCsvRows = enriched.map((e) => ({
      entity_type: e.entity_type,
      name: e.name,
      uid: e.uid ?? "",
      lei: e.lei ?? "",
    lei_source_url: e.lei_source_url ?? "",
    lei_registration_status: e.lei_registration_status ?? "",
    lei_updated_at: e.lei_updated_at ?? "",
    address_source_url: e.address_source_url ?? "",
      licence_type: e.licence_type ?? "",
      licence_type_de: e.licence_type_de ?? "",
      licence_type_fr: e.licence_type_fr ?? "",
      licence_type_it: e.licence_type_it ?? "",
      licence_date: e.licence_date ?? "",
      status: e.status ?? "",
      canton: e.canton ?? "",
      city: e.city ?? "",
      address: e.address ?? "",
      source_list: e.source_list,
      source_url: e.source_url,
      is_warning_listed: typeof e.is_warning_listed === "boolean" ? String(e.is_warning_listed) : "",
      supervisory_organisation: e.supervisory_organisation ?? "",
      supervisory_organisation_source_url: e.supervisory_organisation_source_url ?? "",
      supervisory_organisation_observed_on: e.supervisory_organisation_observed_on ?? "",
      zefix_status: e.zefix_status ?? "",
      zefix_capital: e.zefix_capital ?? "",
      zefix_capital_currency: e.zefix_capital_currency ?? "",
      zefix_legal_form: e.zefix_legal_form ?? "",
      zefix_legal_form_code: e.zefix_legal_form_code ?? "",
      zefix_purpose: e.zefix_purpose ?? "",
      zefix_organes: e.zefix_organes ? JSON.stringify(e.zefix_organes) : "",
      zefix_last_update: e.zefix_last_update ?? "",
      zefix_id: e.zefix_id ?? "",
    }));
    writeCsv(enrichedCsvRows, join(workDir, "finma_with_zefix.csv"));
    writeJson(enriched, join(workDir, "finma_with_zefix.json"));
    writeSqlInserts("finma_with_zefix", enrichedCsvRows, join(workDir, "finma_with_zefix.sql"));
    const enrichedParquetRows = enriched.map((e) => ({
      entity_type: e.entity_type,
      name: e.name,
      uid: e.uid,
      lei: e.lei,
    lei_source_url: e.lei_source_url,
    lei_registration_status: e.lei_registration_status,
    lei_updated_at: e.lei_updated_at,
    address_source_url: e.address_source_url,
      licence_type: e.licence_type,
      licence_type_de: e.licence_type_de,
      licence_type_fr: e.licence_type_fr,
      licence_type_it: e.licence_type_it,
      licence_date: e.licence_date,
      status: e.status,
      canton: e.canton,
      city: e.city,
      address: e.address,
      source_list: e.source_list,
      source_url: e.source_url,
      is_warning_listed: e.is_warning_listed ?? undefined,
      supervisory_organisation: e.supervisory_organisation,
      supervisory_organisation_source_url: e.supervisory_organisation_source_url,
      supervisory_organisation_observed_on: e.supervisory_organisation_observed_on,
      zefix_status: e.zefix_status,
      zefix_capital: e.zefix_capital,
      zefix_capital_currency: e.zefix_capital_currency,
      zefix_legal_form: e.zefix_legal_form,
      zefix_legal_form_code: e.zefix_legal_form_code,
      zefix_purpose: e.zefix_purpose,
      zefix_organes: e.zefix_organes ? JSON.stringify(e.zefix_organes) : undefined,
      zefix_last_update: e.zefix_last_update,
      zefix_id: e.zefix_id,
    }));
    await writeParquet(
      enrichedParquetRows as Record<string, unknown>[],
      FINMA_WITH_ZEFIX_PARQUET_SCHEMA,
      join(workDir, "finma_with_zefix.parquet"),
    );
  }

  // FINMA Warning List — parallel dataset (negative cross-reference).
  const warnings = input.warnings ?? [];
  const warningCsvRows = warnings.map(warningToCsvRow);
  writeCsv(warningCsvRows, join(workDir, "finma_warnings.csv"));
  writeJson(warnings, join(workDir, "finma_warnings.json"));
  writeSqlInserts("finma_warnings", warningCsvRows, join(workDir, "finma_warnings.sql"));
  const warningParquetRows = warnings.map((w) => ({
    name: w.name,
    country: w.country,
    date_added: w.date_added,
    category: w.category,
    source_url: w.source_url,
    source_list: w.source_list,
    warning_type: w.warning_type,
    additional_info: w.additional_info,
  }));
  await writeParquet(
    warningParquetRows as Record<string, unknown>[],
    FINMA_WARNINGS_PARQUET_SCHEMA,
    join(workDir, "finma_warnings.parquet"),
  );

  // Tables de référence : OAR reconnus (sro.xlsx) et OS autorisés (ao.xlsx).
  // Préfixe « reference_ » : finma_supervisory_org.csv existe déjà comme
  // fichier de catégorie du registre (les 4 lignes « Supervisory organisation »).
  const sroCsvRows = (supervision?.sros ?? []).map(o => referenceToCsvRow(o, false));
  const soCsvRows = (supervision?.supervisoryOrganisations ?? []).map(o => referenceToCsvRow(o, true));
  if (supervision) {
    const tables = [
      { file: "finma_reference_sros", rows: sroCsvRows, schema: FINMA_REFERENCE_SROS_PARQUET_SCHEMA },
      { file: "finma_reference_supervisory_organisations", rows: soCsvRows, schema: FINMA_REFERENCE_SO_PARQUET_SCHEMA },
    ];
    for (const table of tables) {
      writeCsv(table.rows, join(workDir, `${table.file}.csv`));
      writeJson(table.rows.map(row => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== ""))), join(workDir, `${table.file}.json`));
      writeSqlInserts(table.file, table.rows, join(workDir, `${table.file}.sql`));
      await writeParquet(
        table.rows.map(row => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== ""))),
        table.schema,
        join(workDir, `${table.file}.parquet`),
      );
    }
  }

  // Changelog (90-day delta) — write even if empty
  const changes = input.recentChanges ?? [];
  writeCsv(changes.map(deltaToCsvRow), join(workDir, "changelog_90d.csv"));
  writeJson(changes, join(workDir, "changelog_90d.json"));
  if (!changes.length) writeFileSync(join(workDir, "changelog_90d.csv"), "observed_at,previous_version,version,kind,entity_type,name,uid,source_list,before,after\n");
  const quality = {
    version, generated_at: new Date().toISOString(), registry_rows: input.entities.length,
    unique_uids: new Set(input.entities.map(e => e.uid).filter(Boolean)).size,
    non_empty_types: Object.values(countByType).filter(n => n > 0).length,
    populated_fields: Object.fromEntries(["uid", "lei", "licence_date", "status", "canton", "city", "address"].map(field => [field, input.entities.filter(e => Boolean(e[field as keyof FinmaEntity])).length])),
    warning_rows: warnings.length,
    warning_matching: "Aucune identité déduite d'une ressemblance de noms. is_warning_listed est indéterminé. Consulter la liste d'avertissements séparée et ses liens FINMA.",
    lei_matching: "UID suisse exact et LEI unique ; identifiants ambigus non attribués. Un LEI LAPSED est non renouvelé ; ce statut n'est pas un statut d'autorisation FINMA.",
    missing_fields: "Le CSV FINMA ne fournit ni date d'autorisation ni statut détaillé. Les valeurs absentes restent vides. Adresses et cantons proviennent de GLEIF lorsque l'UID correspond exactement.",
    history: input.historyCoverage ?? { available_from: null, note: "Historique non fourni pour cette archive." },
    // Bloc séparé de populated_fields : une part de lignes renseignées sur tout
    // le registre (gestionnaires seulement) se lirait comme un trou de collecte.
    supervisory_organisation: supervision
      ? {
          field: "supervisory_organisation",
          meaning: SUPERVISION_MEANING,
          matching: SUPERVISION_MATCHING,
          source: supervision.sources.vvtr,
          ...supervision.matching,
          // Compté sur les lignes réellement livrées (fait foi sur le rapprochement).
          registry_rows_with_value: supervisoryOrganisationRowCount,
        }
      : { field: "supervisory_organisation", meaning: SUPERVISION_MEANING, note: "Non collecté pour cette archive : le champ reste vide." },
    reference_tables: supervision
      ? {
          note: REFERENCE_TABLES_NOTE,
          sros: { file: "finma_reference_sros", rows: sroCsvRows.length, source: supervision.sources.sro },
          supervisory_organisations: { file: "finma_reference_supervisory_organisations", rows: soCsvRows.length, source: supervision.sources.ao },
        }
      : null,
  };
  writeJson(quality, join(workDir, "quality.json"));
  // Or bureautique : cellules texte explicites, sans formule provenant des sources.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(csvRows), "Registre");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(warningCsvRows), "Avertissements");
  if (supervision) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sroCsvRows), "OAR reconnus");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(soCsvRows), "Organismes de surveillance");
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { information: "Version", valeur: version },
    { information: "LEI", valeur: quality.lei_matching },
    { information: "Avertissements", valeur: quality.warning_matching },
    { information: "Champs absents", valeur: quality.missing_fields },
    { information: "Organisme de surveillance (LEFin)", valeur: `${SUPERVISION_MEANING} ${SUPERVISION_MATCHING}` },
    ...(supervision ? [{ information: "Tables de référence", valeur: REFERENCE_TABLES_NOTE }] : []),
    { information: "Historique", valeur: "Voir quality.json pour les périodes couvertes et les interruptions." },
  ]), "Lire avant utilisation");
  XLSX.writeFile(workbook, join(workDir, "finma.xlsx"));

  // Schema
  //
  // L'énumération entity_type livrée n'est pas la liste complète des
  // catégories connues du code (entityTypes ci-dessus, qui sert aussi à
  // countByType et à la boucle des CSV par catégorie) : c'est le sous-
  // ensemble que cette archive peut légitimement justifier — soit parce
  // qu'un libellé AuthorisationTypeEN de la collecte de production s'y
  // mappe réellement (AUTH_TYPE_TO_ENTITY_TYPE, "other" compris, le
  // fourre-tout), soit parce qu'une ligne de CETTE archive porte déjà ce
  // type (couvre un tiers "zefix" ou une source future). Sans ce filtre,
  // une catégorie qui n'a jamais eu et n'aura jamais de ligne (l'ancien
  // sro_member, ou aujourd'hui payment_institution/insurance_intermediary)
  // resterait listée comme si le fichier pouvait la contenir — exactement
  // la promesse rompue documentée dans
  // docs/internal/audit-global-20260925/sro-20260930/RAPPORT.md.
  const reachableEntityTypes = new Set<FinmaEntityType>([...Object.values(AUTH_TYPE_TO_ENTITY_TYPE), "other"]);
  const presentEntityTypes = new Set(input.entities.map(e => e.entity_type));
  const schemaEntityTypes = entityTypes.filter(t => reachableEntityTypes.has(t) || presentEntityTypes.has(t));
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "FINMA Registry Dataset",
    type: "array",
    items: {
      type: "object",
      required: ["entity_type", "name", "source_list", "source_url"],
      properties: {
        entity_type: { enum: schemaEntityTypes },
        name: { type: "string" },
        uid: { type: "string", pattern: "^CHE-\\d{3}\\.\\d{3}\\.\\d{3}$" },
        lei: { type: "string", pattern: "^[A-Z0-9]{20}$" },
        licence_type: { type: "string" },
        licence_date: { type: "string", format: "date" },
        status: { type: "string" },
        canton: { type: "string", pattern: "^[A-Z]{2}$" },
        address: { type: "string" },
        source_list: { type: "string" },
        source_url: { type: "string", format: "uri" },
        lei_source_url: { type: "string", format: "uri" },
        lei_registration_status: { type: "string" },
        lei_updated_at: { type: "string" },
        address_source_url: { type: "string", format: "uri" },
        city: { type: "string" },
        licence_type_de: { type: "string" },
        licence_type_fr: { type: "string" },
        licence_type_it: { type: "string" },
        is_warning_listed: { type: ["boolean", "null"], description: "Indéterminé : une ressemblance de nom ne prouve pas une identité." },
        supervisory_organisation: { type: "string", description: `${SUPERVISION_MEANING} Lignes « Portfolio manager » et « Trustee » seulement. ${SUPERVISION_MATCHING}` },
        supervisory_organisation_source_url: { type: "string", format: "uri", description: "Fichier FINMA d'où provient supervisory_organisation (vvtr.xlsx)." },
        supervisory_organisation_observed_on: { type: "string", format: "date", description: "Date de collecte (UTC) du fichier FINMA qui porte supervisory_organisation." },
      },
    },
  };
  writeJson(schema, join(workDir, "schema.json"));

  // Schémas des tables de référence (seulement quand elles sont livrées).
  const referenceSchema = (title: string, withCity: boolean) => ({
    $schema: "http://json-schema.org/draft-07/schema#",
    title,
    description: REFERENCE_TABLES_NOTE,
    type: "array",
    items: {
      type: "object",
      required: ["name", "address", ...(withCity ? ["city"] : []), "source_url", "observed_on"],
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        address: { type: "string", description: "Adresse telle que publiée par la FINMA (retours à la ligne compris)." },
        ...(withCity ? { city: { type: "string", description: "NPA et localité, colonne « City » de la FINMA." } } : {}),
        website: { type: "string" },
        source_url: { type: "string", format: "uri" },
        observed_on: { type: "string", format: "date" },
      },
    },
  });
  if (supervision) {
    writeJson(referenceSchema("FINMA — organismes d'autorégulation (OAR) reconnus", false), join(workDir, "schema_reference_sros.json"));
    writeJson(referenceSchema("FINMA — organismes de surveillance (OS) autorisés", true), join(workDir, "schema_reference_supervisory_organisations.json"));
  }

  const warningsSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "FINMA Warning List",
    type: "array",
    items: {
      type: "object",
      required: ["name", "source_list", "source_url", "warning_type"],
      properties: {
        name: { type: "string" },
        country: { type: "string" },
        date_added: { type: "string", format: "date" },
        category: { type: "string" },
        source_url: { type: "string", format: "uri" },
        source_list: { const: "finma-warnings" },
        warning_type: { type: "string" },
        additional_info: { type: "string" },
      },
    },
  };
  writeJson(warningsSchema, join(workDir, "schema_warnings.json"));

  // Schema for FINMA + Zefix enriched registry (only when zefix tier active)
  if (includeZefix) {
    const enrichedSchema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "FINMA Registry + Zefix Enrichment",
      type: "array",
      items: {
        type: "object",
        required: ["entity_type", "name", "source_list", "source_url"],
        properties: {
          ...schema.items.properties,
          zefix_status: { enum: ["active", "inactive", "liquidation", "unknown"] },
          zefix_capital: { type: "number" },
          zefix_capital_currency: { type: "string" },
          zefix_legal_form: { type: "string" },
          zefix_legal_form_code: { type: "string", pattern: "^\\d{4}$" },
          zefix_purpose: { type: "string" },
          zefix_organes: { type: "string", description: "JSON-serialized array of organes (board members, signatures)" },
          zefix_last_update: { type: "string", format: "date" },
          zefix_id: { type: "string", description: "Zefix internal company id" },
        },
      },
    };
    writeJson(enrichedSchema, join(workDir, "schema_with_zefix.json"));
  }

  // README
  const zefixSection = includeZefix
    ? `

### FINMA + Zefix Sync (enriched registry)

- \`finma_with_zefix.csv\` / \`.json\` / \`.sql\` / \`.parquet\` — ${input.entities.length} entries (${zefixEnrichedCount} enriched with Zefix data)
- Source: LINDAS SPARQL endpoint \`https://register.ld.admin.ch/query\` (graph \`<https://lindas.admin.ch/foj/zefix>\`)
- Added columns: \`zefix_status\`, \`zefix_capital\`, \`zefix_capital_currency\`, \`zefix_legal_form\`, \`zefix_legal_form_code\`, \`zefix_purpose\`, \`zefix_organes\`, \`zefix_last_update\`, \`zefix_id\`
- Schema: \`schema_with_zefix.json\`
- v1 limitation: LINDAS exposes \`legal_form\`, \`legal_form_code\`, \`purpose\`, \`zefix_id\`. Other fields (\`capital\`, \`organes\`, \`status\`, \`last_update\`) require the authenticated Zefix REST API and remain undefined in this release. See \`SOURCES.md\` in the repo for details.`
    : "";
  const sourceDate = (meta: FinmaSourceFileMeta) => {
    const modified = meta.last_modified ? Date.parse(meta.last_modified) : Number.NaN;
    const dated = Number.isNaN(modified) ? "" : ` (fichier FINMA daté du ${new Date(modified).toISOString().slice(0, 10)})`;
    return `collecté le ${meta.fetched_at.slice(0, 10)}${dated}`;
  };
  const supervisionUsage = supervision
    ? `
- finma_reference_sros.csv / .json / .sql / .parquet : organismes d'autorégulation (OAR) reconnus par la FINMA.
- finma_reference_supervisory_organisations.csv / .json / .sql / .parquet : organismes de surveillance (OS) autorisés par la FINMA.
- schema_reference_sros.json / schema_reference_supervisory_organisations.json : schémas des deux tables de référence.`
    : "";
  const supervisionSection = supervision
    ? `
## Organisme de surveillance des gestionnaires de fortune et trustees

${SUPERVISION_MEANING}
Colonne supervisory_organisation du registre : ${supervisoryOrganisationRowCount} lignes renseignées sur ${supervision.matching.registry_candidate_rows} lignes « Portfolio manager » et « Trustee ».
${SUPERVISION_MATCHING}
Source : ${supervision.sources.vvtr.url}, ${sourceDate(supervision.sources.vvtr)}.

DE: Die Spalte supervisory_organisation nennt für Vermögensverwalter und Trustees die Aufsichtsorganisation nach Finanzinstitutsgesetz (FINIG) gemäss der Liste der FINMA. Sie ist keine Zugehörigkeit zu einer Selbstregulierungsorganisation (SRO, GwG).
EN: The supervisory_organisation column gives, for portfolio managers and trustees, the supervisory organisation under the Financial Institutions Act (FinIA) according to FINMA's list. It is not a self-regulatory organisation (SRO) affiliation under AMLA.

## Tables de référence

${REFERENCE_TABLES_NOTE}
- finma_reference_sros : ${sroCsvRows.length} OAR reconnus. Source : ${supervision.sources.sro.url}, ${sourceDate(supervision.sources.sro)}.
- finma_reference_supervisory_organisations : ${soCsvRows.length} OS autorisés. Source : ${supervision.sources.ao.url}, ${sourceDate(supervision.sources.ao)}.
`
    : "";
  const readme = `# Registre FINMA — version ${version}

${input.entities.length} lignes d'autorisation, réparties dans ${Object.values(countByType).filter(n => n > 0).length} catégories présentes.
${quality.unique_uids} UID distincts. Une même société peut avoir plusieurs autorisations.
${warnings.length} entrées dans la liste d'avertissements séparée.

## Utilisation

- finma.xlsx : classeur Excel, registre et avertissements dans deux feuilles distinctes${supervision ? ", plus les feuilles des OAR reconnus et des organismes de surveillance" : ""}.
- finma_registry.csv / .json / .sql / .parquet : registre normalisé.
- finma_<type>.csv : fichiers des catégories non vides.
- finma_warnings.csv / .json / .sql / .parquet : avertissements officiels et liens de détail.${supervisionUsage}
- changelog_90d.csv / .json : changements réellement observés entre les versions disponibles.
- quality.json : couverture exacte des champs et de l'historique, y compris les interruptions.
- schema.json / schema_warnings.json : schémas de données.
- checksums.sha256 et provenance.json : intégrité, signature Ed25519 et horodatage.
- LICENSE.txt : conditions d'utilisation.

## Lire avant utilisation

${quality.lei_matching}
${quality.warning_matching}
${quality.missing_fields}

Un champ vide signifie inconnu, et non absence d'autorisation ou absence de risque.
La présence dans le registre est celle observée à la date de collecte. Elle ne remplace pas la vérification sur finma.ch.
Les dates du changelog sont des dates d'observation, pas des dates de décision de la FINMA.
Le champ historique is_warning_listed est désormais vide/null : les anciennes valeurs fondées sur la ressemblance des noms ne confirmaient pas une identité et ne doivent pas être utilisées comme telles.

Ce fichier ne contient pas les affiliations aux organismes d'autorégulation (OAR/SRO, loi sur le blanchiment d'argent) ni le registre des intermédiaires d'assurance. Pour vérifier une affiliation à un OAR, consultez la recherche officielle de la FINMA : ${FINMA_OAR_SEARCH_URL_FR}

DE: Diese Datei enthält keine Zugehörigkeiten zu Selbstregulierungsorganisationen (SRO, Geldwäschereigesetz GwG) und kein Register der Versicherungsvermittlerinnen und Versicherungsvermittler. SRO-Mitglieder-Suche der FINMA: ${FINMA_OAR_SEARCH_URL_DE}
EN: This file does not contain self-regulatory organisation (SRO) affiliations under the Anti-Money Laundering Act (AMLA), nor the register for insurance intermediaries. FINMA's official SRO member search: ${FINMA_OAR_SEARCH_URL_EN}
${supervisionSection}
## Couverture par catégorie

${entityTypes.filter(t => countByType[t] > 0).map(t => `- ${t} : ${countByType[t]} lignes`).join("\n")}

## Sources

- FINMA : https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/
- Avertissements : https://www.finma.ch/en/finma-public/warnungen/warning-list/
- GLEIF : https://www.gleif.org/en/lei-data/gleif-api ; rapprochement par UID suisse exact.

Autorisation FINMA de redistribution reçue le 6 mai 2026, sous réserve de ses conditions et de l'intégrité des documents sources.
OpenSwissData est un service indépendant, non affilié à la FINMA.
${zefixSection}
`;
  writeFileSync(join(workDir, "README.md"), readme, "utf8");
  writeFileSync(join(workDir, "LICENSE.txt"), DATASET_LICENSE, "utf8");

  // Checksums of data files (exclude README/LICENSE/checksums themselves)
  const dataFiles = [
    "finma_registry.csv", "finma_registry.json", "finma_registry.sql", "finma_registry.parquet",
    ...entityTypes.filter(t => countByType[t] > 0).map(t => `finma_${t}.csv`),
    "finma_warnings.csv", "finma_warnings.json", "finma_warnings.sql", "finma_warnings.parquet",
    "changelog_90d.csv", "changelog_90d.json",
    "schema.json", "schema_warnings.json", "quality.json", "finma.xlsx",
    ...(includeZefix
      ? [
          "finma_with_zefix.csv",
          "finma_with_zefix.json",
          "finma_with_zefix.sql",
          "finma_with_zefix.parquet",
          "schema_with_zefix.json",
        ]
      : []),
    ...(supervision
      ? [
          ...["finma_reference_sros", "finma_reference_supervisory_organisations"].flatMap(f => ["csv", "json", "sql", "parquet"].map(ext => `${f}.${ext}`)),
          "schema_reference_sros.json",
          "schema_reference_supervisory_organisations.json",
        ]
      : []),
  ];
  const checksums = dataFiles.map(f => {
    const content = readFileSync(join(workDir, f));
    const hash = createHash("sha256").update(content).digest("hex");
    return `${hash}  ${f}`;
  }).join("\n") + "\n";
  writeFileSync(join(workDir, "checksums.sha256"), checksums, "utf8");

  // Provenance manifest (signed Ed25519 + RFC-3161 timestamp)
  const manifestFiles: ProvenanceFile[] = [
    ...dataFiles,
    "README.md",
    "LICENSE.txt",
    "checksums.sha256",
  ].map((f) => {
    const p = join(workDir, f);
    const buf = readFileSync(p);
    return { name: f, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  });
  const provenance = await buildSignedProvenance({
    ...provenanceFieldsFor("finma"),
    dataset: "finma",
    version,
    files: manifestFiles,
    withTimestamp: opts.withTimestamp,
    signing: opts.signing,
  });
  writeFileSync(join(workDir, "provenance.json"), JSON.stringify(provenance, null, 2), "utf8");

  // ZIP
  const zipPath = join(outDir, `finma-${version}.zip`);
  if (existsSync(zipPath)) rmSync(zipPath);
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(workDir, false);
    archive.finalize();
  });

  const buf = readFileSync(zipPath);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const sizeBytes = statSync(zipPath).size;

  // Copy the registry CSV and the standalone warnings outputs to outDir
  // BEFORE deleting workDir, so that downstream smoke tests / operators
  // don't have to extract the zip to inspect them.
  for (const f of [
    "finma_registry.csv",
    "finma_warnings.csv",
    "finma_warnings.json",
    "finma_warnings.parquet",
  ]) {
    const src = join(workDir, f);
    if (existsSync(src)) copyFileSync(src, join(outDir, f));
  }

  rmSync(workDir, { recursive: true, force: true });

  return {
    zipPath,
    sha256,
    sizeBytes,
    version,
    entityCount: input.entities.length,
    countByType,
    changeCount: changes.length,
    warningCount: warnings.length,
    warningListedFlagCount,
    zefixEnrichedCount,
    supervisoryOrganisationRowCount,
    referenceSroCount: sroCsvRows.length,
    referenceSupervisoryOrganisationCount: soCsvRows.length,
  };
}
