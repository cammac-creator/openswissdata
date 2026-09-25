import { mkdirSync, rmSync, existsSync, createWriteStream, readFileSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import XLSX from "../shared/xlsx.js";
import { createHash } from "node:crypto";
import parquet from "parquetjs-lite";
import { writeCsv, writeJson, writeSqlInserts, writeParquet } from "../shared/formats.js";
import { buildSignedProvenance, PERMISSION_PROFILES, type ProvenanceFile } from "../shared/provenance.js";
import type { FinmaEntity, FinmaEntityType, FinmaWarning } from "./types.js";
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

const DATASET_LICENSE = `openswissdata.com — Dataset License v1.0

Copyright © 2026 Claude-Alain Martin · openswissdata.com

This dataset is licensed, not sold.

PERMITTED USES:
- Commercial use within your organization
- Derivation and transformation for internal projects
- Integration into your products or services (without redistributing the raw dataset)

PROHIBITED USES:
- Public redistribution of the dataset or substantial portions thereof
- Resale of the dataset in original or modified form
- Republishing on public data marketplaces (Kaggle, data.world, etc.)

ATTRIBUTION:
Attribution is appreciated but not required. Suggested:
"Data provided by openswissdata.com (source: FINMA — Swiss Financial Market Supervisory Authority)"

WARRANTY:
Provided "AS IS" without warranty. Data is normalized from official FINMA lists.
openswissdata.com is not responsible for errors in the underlying official sources.
openswissdata.com is not affiliated with FINMA, does not represent FINMA, and its
data does not substitute for direct consultation of finma.ch.

SOURCE PERMISSION:
Republication authorised in writing by FINMA Communication on 2026-05-06
(ref. FINMA-PERMISSION-2026-05-06-NADINE-BUCHER), subject to respecting FINMA
copyright and the integrity of source documents. Source: FINMA, www.finma.ch.
FINMA Terms of Use: https://www.finma.ch/en/terms-and-conditions/

LIABILITY:
Liability capped at the purchase price of this dataset.

GOVERNING LAW:
Swiss law. For: Vaud, Switzerland (1045 Ogens).

Contact: contact@openswissdata.com
`;

export interface FinmaBundleInput {
  entities: FinmaEntity[];
  warnings?: FinmaWarning[];
  recentChanges?: DeltaChange[]; // Historique réellement observé.
  historyCoverage?: Record<string, unknown>;
  /** Tier "FINMA + Zefix Sync": Zefix data keyed by FINMA UID. Optional. */
  zefixByUid?: Map<string, ZefixData>;
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
}

export async function buildBundle(
  input: FinmaBundleInput,
  version: string,
  outDir: string,
  opts: FinmaBuildBundleOptions = {},
): Promise<FinmaBundleResult> {
  const workDir = join(outDir, `finma-${version}-work`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const countByType = {} as Record<FinmaEntityType, number>;
  const entityTypes: FinmaEntityType[] = [
    "bank", "insurance", "asset_manager_collective", "asset_manager_individual",
    "securities_firm", "fund_representative", "payment_institution",
    "sro_member", "supervisory_org", "insurance_intermediary",
    "fintech", "infrastructure", "other",
  ];
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
  };
  writeJson(quality, join(workDir, "quality.json"));
  // Or bureautique : cellules texte explicites, sans formule provenant des sources.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(csvRows), "Registre");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(warningCsvRows), "Avertissements");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { information: "Version", valeur: version },
    { information: "LEI", valeur: quality.lei_matching },
    { information: "Avertissements", valeur: quality.warning_matching },
    { information: "Champs absents", valeur: quality.missing_fields },
    { information: "Historique", valeur: "Voir quality.json pour les périodes couvertes et les interruptions." },
  ]), "Lire avant utilisation");
  XLSX.writeFile(workbook, join(workDir, "finma.xlsx"));

  // Schema
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "FINMA Registry Dataset",
    type: "array",
    items: {
      type: "object",
      required: ["entity_type", "name", "source_list", "source_url"],
      properties: {
        entity_type: { enum: entityTypes },
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
      },
    },
  };
  writeJson(schema, join(workDir, "schema.json"));

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
  const readme = `# Registre FINMA — version ${version}

${input.entities.length} lignes d'autorisation, réparties dans ${Object.values(countByType).filter(n => n > 0).length} catégories présentes.
${quality.unique_uids} UID distincts. Une même société peut avoir plusieurs autorisations.
${warnings.length} entrées dans la liste d'avertissements séparée.

## Utilisation

- finma.xlsx : classeur Excel, registre et avertissements dans deux feuilles distinctes.
- finma_registry.csv / .json / .sql / .parquet : registre normalisé.
- finma_<type>.csv : fichiers des catégories non vides.
- finma_warnings.csv / .json / .sql / .parquet : avertissements officiels et liens de détail.
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
  const profile = PERMISSION_PROFILES.finma;
  const provenance = await buildSignedProvenance({
    dataset: "finma",
    version,
    sourceUrl: profile.sourceUrl,
    files: manifestFiles,
    permissionReference: profile.permissionReference,
    permissionAuthority: profile.permissionAuthority,
    jurisdiction: profile.jurisdiction,
    withTimestamp: opts.withTimestamp,
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
  };
}
