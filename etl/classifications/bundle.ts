import { mkdirSync, rmSync, existsSync, createWriteStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import { createHash } from "node:crypto";
import parquet from "parquetjs-lite";
import { writeCsv, writeJson, writeSqlInserts, writeSqlInsertsChunked, writeParquet } from "../shared/formats.js";
import { buildSignedProvenance, PERMISSION_PROFILES, type ProvenanceFile } from "../shared/provenance.js";
import type { NomenclatureRow, CrossWalkRow, NomenclatureScheme } from "./types.js";
import type { IngestStatentResult } from "./ingest-statent.js";
import {
  NOGA_EMBEDDING_DIMENSIONS,
  NOGA_EMBEDDING_MODEL,
  NOGA_EMBEDDING_MODEL_VERSION,
  type NogaEmbedding,
} from "./embeddings.js";
import { naceEnLabelToCsvRow, type NaceEnLabelRow } from "./nace-en-labels.js";
import { naicsCrosswalkToCsvRow, type NaicsCrosswalkRow, type IngestNaicsResult } from "./naics-crosswalk.js";

const NOMENCLATURE_PARQUET_SCHEMA = new parquet.ParquetSchema({
  scheme: { type: "UTF8" },
  code: { type: "UTF8" },
  level: { type: "UTF8" },
  parent: { type: "UTF8", optional: true },
  label_fr: { type: "UTF8", optional: true },
  label_de: { type: "UTF8", optional: true },
  label_it: { type: "UTF8", optional: true },
  label_en: { type: "UTF8", optional: true },
});

const CROSSWALK_PARQUET_SCHEMA = new parquet.ParquetSchema({
  noga_2008: { type: "UTF8", optional: true },
  noga_2025: { type: "UTF8", optional: true },
  nace_2_0: { type: "UTF8", optional: true },
  nace_2_1: { type: "UTF8", optional: true },
  isic_4: { type: "UTF8", optional: true },
  mapping_type: { type: "UTF8" },
  notes: { type: "UTF8", optional: true },
});

const STATENT_CANTON_DIVISION_SCHEMA = new parquet.ParquetSchema({
  year: { type: "INT32", compression: "GZIP" },
  canton_bfs_id: { type: "INT32", compression: "GZIP" },
  canton_label: { type: "UTF8", compression: "GZIP" },
  noga_division: { type: "UTF8", compression: "GZIP" },
  noga_division_label: { type: "UTF8", compression: "GZIP" },
  observation_unit: { type: "UTF8", compression: "GZIP" },
  value: { type: "DOUBLE", optional: true, compression: "GZIP" },
});

const STATENT_COMMUNE_SECTOR_SCHEMA = new parquet.ParquetSchema({
  year: { type: "INT32", compression: "GZIP" },
  commune_bfs_id: { type: "INT32", compression: "GZIP" },
  commune_label: { type: "UTF8", compression: "GZIP" },
  sector: { type: "UTF8", compression: "GZIP" },
  sector_label: { type: "UTF8", compression: "GZIP" },
  observation_unit: { type: "UTF8", compression: "GZIP" },
  value: { type: "DOUBLE", optional: true, compression: "GZIP" },
});

// NOGA 2025 embeddings parquet (Phase 1 / C3). FLOAT (32-bit) instead of DOUBLE
// because the model's native precision is float32 — saves 50 % on disk.
// `repeated: true` declares a Parquet REPEATED column = list<float>.
const NOGA_EMBEDDINGS_PARQUET_SCHEMA = new parquet.ParquetSchema({
  code: { type: "UTF8" },
  lang: { type: "UTF8" },
  description: { type: "UTF8" },
  embedding: { type: "FLOAT", repeated: true },
  model: { type: "UTF8" },
  model_version: { type: "UTF8" },
});

// NAICS 2022 ↔ ISIC 4 ↔ NACE 2.1 ↔ NOGA 2025 crosswalk (Pro tier add-on).
const NAICS_CROSSWALK_PARQUET_SCHEMA = new parquet.ParquetSchema({
  naics_2022: { type: "UTF8" },
  naics_2022_title: { type: "UTF8" },
  isic_4: { type: "UTF8" },
  isic_4_title: { type: "UTF8" },
  nace_2_1: { type: "UTF8", optional: true },
  noga_2025: { type: "UTF8", optional: true },
  mapping_type: { type: "UTF8" },
  notes: { type: "UTF8", optional: true },
});

// NACE Rev 2.1 EN labels (Pro tier add-on).
const NACE_EN_LABELS_PARQUET_SCHEMA = new parquet.ParquetSchema({
  code: { type: "UTF8" },
  level: { type: "UTF8" },
  parent: { type: "UTF8", optional: true },
  label_en: { type: "UTF8" },
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
"Data provided by openswissdata.com (sources: BFS, Eurostat Ramon, UN Statistics)"

WARRANTY:
Provided "AS IS" without warranty. Data is normalized from official sources.
openswissdata.com is not responsible for errors in the underlying official sources.

LIABILITY:
Liability capped at the purchase price of this dataset.

GOVERNING LAW:
Swiss law. For: Vaud, Switzerland (1045 Ogens).

Contact: contact@openswissdata.com
`;

export interface ClassificationsBundleInput {
  rows: NomenclatureRow[];
  crossWalks: CrossWalkRow[];
  /**
   * Historical Pro tier add-on: STATENT (BFS structural establishments + FTE).
   * @deprecated Removed from the Pro tier 2026-04-30 — license `terms_by_ask`
   *   not obtained from BFS. The schema branch is kept dormant in `bundle.ts`
   *   so historical bundle reproduction stays bit-identical, but `release.ts`
   *   no longer passes this field.
   */
  statent?: IngestStatentResult;
  /**
   * Pro tier add-on: pre-computed NOGA 2025 embeddings (Phase 1 / C3).
   * Now contains FR + DE + IT + EN vectors (one row per code × lang).
   */
  embeddings?: NogaEmbedding[];
  /** Pro tier add-on (2026-04-30): NAICS 2022 ↔ ISIC ↔ NACE/NOGA crosswalk rows. */
  naics?: IngestNaicsResult;
  /** Pro tier add-on (2026-04-30): NACE Rev 2.1 official EN labels (stand-alone CSV/Parquet). */
  naceEnLabels?: NaceEnLabelRow[];
}

export interface ClassificationsBundleResult {
  zipPath: string;
  sha256: string;
  sizeBytes: number;
  version: string;
  nomenclatureCount: Record<NomenclatureScheme, number>;
  crossWalkCount: number;
  statentRowCount?: { canton_division: number; commune_sector: number };
  embeddingCount?: number;
  /** Per-language embedding counts (Pro tier — 2026-04-30 multilingual upgrade). */
  embeddingCountByLang?: Record<"fr" | "de" | "it" | "en", number>;
  /** NAICS crosswalk row count (Pro tier add-on). */
  naicsCrosswalkCount?: number;
  /** NACE 2.1 EN labels row count (Pro tier add-on). */
  naceEnLabelCount?: number;
}

function nomenclatureToCsvRow(r: NomenclatureRow): Record<string, unknown> {
  return {
    scheme: r.scheme,
    code: r.code,
    level: r.level,
    parent: r.parent ?? "",
    label_fr: r.label_fr ?? "",
    label_de: r.label_de ?? "",
    label_it: r.label_it ?? "",
    label_en: r.label_en ?? "",
  };
}

function crossWalkToCsvRow(w: CrossWalkRow): Record<string, unknown> {
  return {
    noga_2008: w.noga_2008 ?? "",
    noga_2025: w.noga_2025 ?? "",
    nace_2_0: w.nace_2_0 ?? "",
    nace_2_1: w.nace_2_1 ?? "",
    isic_4: w.isic_4 ?? "",
    mapping_type: w.mapping_type,
    notes: w.notes ?? "",
  };
}

export interface ClassificationsBuildBundleOptions {
  /** Skip the RFC-3161 timestamp call (used in offline tests). */
  withTimestamp?: boolean;
}

export async function buildBundle(
  input: ClassificationsBundleInput,
  version: string,
  outDir: string,
  opts: ClassificationsBuildBundleOptions = {},
): Promise<ClassificationsBundleResult> {
  const workDir = join(outDir, `classifications-${version}-work`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const schemes: NomenclatureScheme[] = ["NOGA_2008", "NOGA_2025", "NACE_2.0", "NACE_2.1", "ISIC_4"];
  const nomenclatureCount: Record<NomenclatureScheme, number> = {
    NOGA_2008: 0,
    NOGA_2025: 0,
    "NACE_2.0": 0,
    "NACE_2.1": 0,
    ISIC_4: 0,
  };

  // Per-scheme files
  for (const scheme of schemes) {
    const filtered = input.rows.filter((r) => r.scheme === scheme);
    nomenclatureCount[scheme] = filtered.length;
    // slug: "noga_2008", "noga_2025", "nace_2_0", "nace_2_1", "isic_4"
    const slug = scheme.toLowerCase().replace(/\./g, "_");
    writeCsv(filtered.map(nomenclatureToCsvRow), join(workDir, `${slug}.csv`));
    writeJson(filtered, join(workDir, `${slug}.json`));
    writeSqlInserts(
      slug.replace(/[^a-z0-9]/g, "_"),
      filtered.map(nomenclatureToCsvRow),
      join(workDir, `${slug}.sql`),
    );
  }

  // Combined parquet (all schemes in one file with "scheme" column)
  const allForParquet = input.rows.map((r) => ({
    scheme: r.scheme,
    code: r.code,
    level: r.level,
    parent: r.parent ?? undefined,
    label_fr: r.label_fr,
    label_de: r.label_de,
    label_it: r.label_it,
    label_en: r.label_en,
  }));
  await writeParquet(
    allForParquet as unknown as Record<string, unknown>[],
    NOMENCLATURE_PARQUET_SCHEMA,
    join(workDir, "nomenclatures.parquet"),
  );

  // Cross-walks
  writeCsv(input.crossWalks.map(crossWalkToCsvRow), join(workDir, "crosswalks.csv"));
  writeJson(input.crossWalks, join(workDir, "crosswalks.json"));
  writeSqlInserts(
    "crosswalks",
    input.crossWalks.map(crossWalkToCsvRow),
    join(workDir, "crosswalks.sql"),
  );
  const crossWalksForParquet = input.crossWalks.map((w) => ({
    noga_2008: w.noga_2008 ?? undefined,
    noga_2025: w.noga_2025 ?? undefined,
    nace_2_0: w.nace_2_0 ?? undefined,
    nace_2_1: w.nace_2_1 ?? undefined,
    isic_4: w.isic_4 ?? undefined,
    mapping_type: w.mapping_type,
    notes: w.notes ?? undefined,
  }));
  await writeParquet(
    crossWalksForParquet as unknown as Record<string, unknown>[],
    CROSSWALK_PARQUET_SCHEMA,
    join(workDir, "crosswalks.parquet"),
  );

  // STATENT (Pro tier — establishments + FTE × dimensions × year)
  const statentFiles: string[] = [];
  if (input.statent) {
    const cd = input.statent.cantonDivision.map((r) => ({
      year: r.year,
      canton_bfs_id: r.canton_bfs_id,
      canton_label: r.canton_label,
      noga_division: r.noga_division,
      noga_division_label: r.noga_division_label,
      observation_unit: r.observation_unit,
      value: r.value,
    }));
    const cs = input.statent.communeSector.map((r) => ({
      year: r.year,
      commune_bfs_id: r.commune_bfs_id,
      commune_label: r.commune_label,
      sector: r.sector,
      sector_label: r.sector_label,
      observation_unit: r.observation_unit,
      value: r.value,
    }));

    writeCsv(
      cd.map((r) => ({ ...r, value: r.value === null ? "" : r.value })),
      join(workDir, "statent_canton_division.csv"),
    );
    writeCsv(
      cs.map((r) => ({ ...r, value: r.value === null ? "" : r.value })),
      join(workDir, "statent_commune_sector.csv"),
    );
    statentFiles.push("statent_canton_division.csv", "statent_commune_sector.csv");

    // Parquet — efficient for the long-form tables.
    await writeParquet(
      cd.map((r) => ({ ...r, value: r.value ?? undefined })) as unknown as Record<string, unknown>[],
      STATENT_CANTON_DIVISION_SCHEMA,
      join(workDir, "statent_canton_division.parquet"),
    );
    await writeParquet(
      cs.map((r) => ({ ...r, value: r.value ?? undefined })) as unknown as Record<string, unknown>[],
      STATENT_COMMUNE_SECTOR_SCHEMA,
      join(workDir, "statent_commune_sector.parquet"),
    );
    statentFiles.push("statent_canton_division.parquet", "statent_commune_sector.parquet");

    // SQL — chunk INSERTs to keep the file usable on most clients.
    writeSqlInsertsChunked(
      "statent_canton_division",
      cd.map((r) => ({ ...r, value: r.value ?? null })),
      join(workDir, "statent_canton_division.sql"),
      1000,
    );
    writeSqlInsertsChunked(
      "statent_commune_sector",
      cs.map((r) => ({ ...r, value: r.value ?? null })),
      join(workDir, "statent_commune_sector.sql"),
      1000,
    );
    statentFiles.push("statent_canton_division.sql", "statent_commune_sector.sql");

    // Per-bundle source manifest for STATENT.
    writeJson(
      {
        source: input.statent.source,
        stats: input.statent.stats,
      },
      join(workDir, "statent_source.json"),
    );
    statentFiles.push("statent_source.json");
  }

  // NOGA 2025 embeddings parquet (Phase 1 / C3 — Pro tier only).
  // We rely on the caller (release.ts) to have already paid the inference cost.
  // 2026-04-30: now multilingual — split per-language into one parquet per
  // language so consumers can load only the language they need (FR/DE/IT/EN).
  const embeddingFiles: string[] = [];
  const hasEmbeddings = !!input.embeddings && input.embeddings.length > 0;
  const embeddingCountByLang: Record<"fr" | "de" | "it" | "en", number> = {
    fr: 0,
    de: 0,
    it: 0,
    en: 0,
  };
  if (hasEmbeddings) {
    const allLangs: ReadonlyArray<"fr" | "de" | "it" | "en"> = ["fr", "de", "it", "en"];
    for (const lang of allLangs) {
      const subset = input.embeddings!.filter((e) => e.lang === lang);
      embeddingCountByLang[lang] = subset.length;
      if (subset.length === 0) continue;
      const rows = subset.map((e) => ({
        code: e.code,
        lang: e.lang,
        description: e.description,
        embedding: e.embedding,
        model: e.model,
        model_version: e.model_version,
      }));
      const filename = `noga_2025_embeddings_${lang}.parquet`;
      await writeParquet(
        rows as unknown as Record<string, unknown>[],
        NOGA_EMBEDDINGS_PARQUET_SCHEMA,
        join(workDir, filename),
      );
      embeddingFiles.push(filename);
    }
  }

  // NAICS 2022 ↔ ISIC ↔ NACE 2.1 ↔ NOGA 2025 crosswalk (Pro tier add-on).
  const naicsFiles: string[] = [];
  const hasNaics = !!input.naics && input.naics.rows.length > 0;
  if (hasNaics) {
    const csvRows = input.naics!.rows.map(naicsCrosswalkToCsvRow);
    writeCsv(csvRows, join(workDir, "naics_nace_crosswalk.csv"));
    writeJson(input.naics!.rows, join(workDir, "naics_nace_crosswalk.json"));
    writeSqlInsertsChunked(
      "naics_nace_crosswalk",
      csvRows,
      join(workDir, "naics_nace_crosswalk.sql"),
      1000,
    );
    const parquetRows = input.naics!.rows.map((r) => ({
      naics_2022: r.naics_2022,
      naics_2022_title: r.naics_2022_title,
      isic_4: r.isic_4,
      isic_4_title: r.isic_4_title,
      nace_2_1: r.nace_2_1 ?? undefined,
      noga_2025: r.noga_2025 ?? undefined,
      mapping_type: r.mapping_type,
      notes: r.notes ?? undefined,
    }));
    await writeParquet(
      parquetRows as unknown as Record<string, unknown>[],
      NAICS_CROSSWALK_PARQUET_SCHEMA,
      join(workDir, "naics_nace_crosswalk.parquet"),
    );
    writeJson(
      { source: input.naics!.source, stats: input.naics!.stats },
      join(workDir, "naics_source.json"),
    );
    naicsFiles.push(
      "naics_nace_crosswalk.csv",
      "naics_nace_crosswalk.json",
      "naics_nace_crosswalk.sql",
      "naics_nace_crosswalk.parquet",
      "naics_source.json",
    );
  }

  // NACE Rev 2.1 EN labels (Pro tier add-on — official Eurostat English).
  const naceEnLabelsFiles: string[] = [];
  const hasNaceEnLabels = !!input.naceEnLabels && input.naceEnLabels.length > 0;
  if (hasNaceEnLabels) {
    const csvRows = input.naceEnLabels!.map(naceEnLabelToCsvRow);
    writeCsv(csvRows, join(workDir, "nace_2_1_en_labels.csv"));
    writeJson(input.naceEnLabels!, join(workDir, "nace_2_1_en_labels.json"));
    const parquetRows = input.naceEnLabels!.map((r) => ({
      code: r.code,
      level: r.level,
      parent: r.parent ?? undefined,
      label_en: r.label_en,
    }));
    await writeParquet(
      parquetRows as unknown as Record<string, unknown>[],
      NACE_EN_LABELS_PARQUET_SCHEMA,
      join(workDir, "nace_2_1_en_labels.parquet"),
    );
    naceEnLabelsFiles.push(
      "nace_2_1_en_labels.csv",
      "nace_2_1_en_labels.json",
      "nace_2_1_en_labels.parquet",
    );
  }

  // JSON Schema (one schema file documenting both nomenclature + crosswalk row shapes)
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Swiss Economic Classifications Bundle",
    description: "Normalized NOGA 2008/2025 + NACE Rev 2/2.1 + ISIC Rev 4 with 5-way cross-walks",
    definitions: {
      NomenclatureRow: {
        type: "object",
        required: ["scheme", "code", "level"],
        properties: {
          scheme: { enum: ["NOGA_2008", "NOGA_2025", "NACE_2.0", "NACE_2.1", "ISIC_4"] },
          code: { type: "string" },
          level: { enum: ["section", "division", "group", "class", "subclass"] },
          parent: { type: ["string", "null"] },
          label_fr: { type: "string" },
          label_de: { type: "string" },
          label_it: { type: "string" },
          label_en: { type: "string" },
        },
      },
      CrossWalkRow: {
        type: "object",
        required: ["mapping_type"],
        properties: {
          noga_2008: { type: ["string", "null"] },
          noga_2025: { type: ["string", "null"] },
          nace_2_0: { type: ["string", "null"] },
          nace_2_1: { type: ["string", "null"] },
          isic_4: { type: ["string", "null"] },
          mapping_type: { enum: ["exact", "partial", "aggregated", "derived"] },
          notes: { type: "string" },
        },
      },
      ...(hasEmbeddings
        ? {
            NogaEmbeddingRow: {
              type: "object",
              required: ["code", "lang", "description", "embedding", "model", "model_version"],
              properties: {
                code: { type: "string" },
                lang: { enum: ["fr", "de", "it", "en"] },
                description: { type: "string" },
                embedding: {
                  type: "array",
                  items: { type: "number" },
                  minItems: NOGA_EMBEDDING_DIMENSIONS,
                  maxItems: NOGA_EMBEDDING_DIMENSIONS,
                },
                model: { type: "string" },
                model_version: { type: "string" },
              },
            },
          }
        : {}),
    },
    ...(hasEmbeddings || hasNaics || hasNaceEnLabels
      ? {
          files: {
            ...(hasEmbeddings
              ? Object.fromEntries(
                  embeddingFiles.map((f) => [
                    f,
                    {
                      description: `Pre-computed multilingual semantic embeddings for NOGA 2025 codes (Phase 1 / C3). Columns: code, lang, description, embedding (list<float>, ${NOGA_EMBEDDING_DIMENSIONS}d, L2-normalised), model (${NOGA_EMBEDDING_MODEL}), model_version (${NOGA_EMBEDDING_MODEL_VERSION}). Vectors are L2-normalised so cosine similarity reduces to a dot product. See SOURCES.md → "Embeddings & classification" for a Python load + FAISS search snippet.`,
                      row_shape: "$defs/NogaEmbeddingRow",
                    },
                  ]),
                )
              : {}),
            ...(hasNaics
              ? {
                  "naics_nace_crosswalk.parquet": {
                    description:
                      "NAICS 2022 ↔ ISIC Rev 4 ↔ NACE Rev 2.1 ↔ NOGA 2025 crosswalk via the U.S. Census Bureau concordance + ISIC pivot. Public Domain (US Government Work).",
                    row_shape: "$defs/NaicsCrosswalkRow",
                  },
                }
              : {}),
            ...(hasNaceEnLabels
              ? {
                  "nace_2_1_en_labels.parquet": {
                    description:
                      "NACE Rev 2.1 official English labels (Eurostat re-use policy). Stand-alone projection of the EN labels embedded in nace_2_1.{csv,json,sql} for compliance officers.",
                    row_shape: "$defs/NaceEnLabelRow",
                  },
                }
              : {}),
          },
        }
      : {}),
  };
  // Add the schema definitions for NAICS / NACE EN labels rows.
  if (hasNaics) {
    (schema.definitions as Record<string, unknown>).NaicsCrosswalkRow = {
      type: "object",
      required: [
        "naics_2022",
        "naics_2022_title",
        "isic_4",
        "isic_4_title",
        "mapping_type",
      ],
      properties: {
        naics_2022: { type: "string" },
        naics_2022_title: { type: "string" },
        isic_4: { type: "string" },
        isic_4_title: { type: "string" },
        nace_2_1: { type: ["string", "null"] },
        noga_2025: { type: ["string", "null"] },
        mapping_type: { enum: ["exact", "partial"] },
        notes: { type: ["string", "null"] },
      },
    };
  }
  if (hasNaceEnLabels) {
    (schema.definitions as Record<string, unknown>).NaceEnLabelRow = {
      type: "object",
      required: ["code", "level", "label_en"],
      properties: {
        code: { type: "string" },
        level: { enum: ["section", "division", "group", "class", "subclass"] },
        parent: { type: ["string", "null"] },
        label_en: { type: "string" },
      },
    };
  }
  writeJson(schema, join(workDir, "schema.json"));

  // README
  const statentSection = input.statent
    ? `

### STATENT (Pro tier — establishments + FTE)

This bundle includes data from the Swiss BFS Statistique structurelle des
entreprises (STATENT), exposed via the BFS PX-Web JSON-stat2 API:

- \`statent_canton_division.{csv,parquet,sql}\` — **${input.statent.cantonDivision.length}** rows.
  Year × Canton (BFS ID 1..26) × NOGA division (2-digit) × Observation unit
  (establishments, employment {total/female/male}, FTE {total/female/male}).
  Years ingested: ${input.statent.stats.years_ingested.join(", ") || "(none)"}.
- \`statent_commune_sector.{csv,parquet,sql}\` — **${input.statent.communeSector.length}** rows.
  Year × Commune (BFS ID) × Sector (total/primary/secondary/tertiary) × Observation unit.
  Same year coverage.
- \`statent_source.json\` — source metadata, license, fetch stats.

#### Joining STATENT with the classifications

- The \`noga_division\` column is a 2-digit NOGA code that joins to the \`code\`
  column of \`noga_2008\` / \`noga_2025\` / \`nace_2_0\` / \`nace_2_1\` at \`level=division\`.
- \`commune_bfs_id\` is the official Federal commune identifier; the same key
  appears in any BFS commune master list (e.g. STAT-TAB px-d-00).
- Cells suppressed for statistical confidentiality (1–4 establishments) are
  serialized as \`null\` (Parquet) / empty CSV cell / SQL NULL. Total suppressed:
  ${input.statent.stats.suppressed_cells}.

#### Scope and confidentiality (important)

BFS does **not** publish a commune × full-NOGA-class table publicly because
cells with 1–4 establishments would breach the statistical confidentiality
mandate. The two slices above are the finest public granularity STATENT exposes.
For finer joins, BFS offers a contractual data agreement (statent@bfs.admin.ch).

#### License — STATENT (terms_by_ask)

STATENT is published under the **terms_by_ask** designation on opendata.swiss:
free for non-commercial use; **commercial redistribution requires written
authorisation from BFS**. The Classifications Pro tier is sold commercially —
ensure a BFS waiver is on file before redistributing this bundle.

Source URL: https://opendata.swiss/fr/dataset/betriebszahlung-unternehmensstatistik-arbeitsstatten
Attribution: "OFS — Statistique structurelle des entreprises (STATENT)"
`
    : "";

  const readme = `# Swiss Economic Classifications Bundle — version ${version}

Normalized economic activity classifications for Swiss and international reporting:

- **NOGA 2008** — ${nomenclatureCount["NOGA_2008"]} rows
- **NOGA 2025** — ${nomenclatureCount["NOGA_2025"]} rows
- **NACE Rev 2** (2.0) — ${nomenclatureCount["NACE_2.0"]} rows
- **NACE Rev 2.1** — ${nomenclatureCount["NACE_2.1"]} rows
- **ISIC Rev 4** — ${nomenclatureCount["ISIC_4"]} rows
- **Cross-walks** — ${input.crossWalks.length} mappings (5-way NOGA↔NACE↔ISIC)
${input.statent ? `- **STATENT (Pro)** — ${input.statent.cantonDivision.length + input.statent.communeSector.length} rows (${input.statent.stats.years_ingested.length} years)` : ""}
${hasEmbeddings ? `- **NOGA 2025 embeddings (Pro)** — ${input.embeddings!.length} pre-computed semantic vectors (${NOGA_EMBEDDING_DIMENSIONS}d, FR/DE/IT/EN)` : ""}
${hasNaics ? `- **NAICS 2022 ↔ ISIC ↔ NACE/NOGA crosswalk (Pro)** — ${input.naics!.rows.length} mappings (US Census Bureau, Public Domain)` : ""}
${hasNaceEnLabels ? `- **NACE Rev 2.1 EN labels (Pro)** — ${input.naceEnLabels!.length} official Eurostat English labels` : ""}

## Files

### Per scheme (CSV/JSON/SQL)

- \`noga_2008.{csv,json,sql}\`
- \`noga_2025.{csv,json,sql}\`
- \`nace_2_0.{csv,json,sql}\`
- \`nace_2_1.{csv,json,sql}\`
- \`isic_4.{csv,json,sql}\`

### Combined (Parquet)

- \`nomenclatures.parquet\` — all 5 schemes in one file with a \`scheme\` column

### Cross-walks

- \`crosswalks.{csv,json,sql,parquet}\` — one row per NOGA 2025 class linking to the 4 other standards${statentSection}${
    hasEmbeddings
      ? `

### NOGA 2025 multilingual embeddings (Pro tier — Phase 1 / C3)

One parquet per language (FR / DE / IT / EN) so consumers load only what they need:

- \`noga_2025_embeddings_fr.parquet\` — ${embeddingCountByLang.fr} rows
- \`noga_2025_embeddings_de.parquet\` — ${embeddingCountByLang.de} rows
- \`noga_2025_embeddings_it.parquet\` — ${embeddingCountByLang.it} rows
- \`noga_2025_embeddings_en.parquet\` — ${embeddingCountByLang.en} rows

Columns: \`code\`, \`lang\`, \`description\`, \`embedding\` (list<float>, ${NOGA_EMBEDDING_DIMENSIONS}d),
\`model\` (\`${NOGA_EMBEDDING_MODEL}\`), \`model_version\` (\`${NOGA_EMBEDDING_MODEL_VERSION}\`).
Vectors are L2-normalised so cosine similarity reduces to a dot product. The model is multilingual,
so cross-language queries match cleanly. See SOURCES.md → "Embeddings & classification" for a
Python load + FAISS search snippet.`
      : ""
  }${
    hasNaics
      ? `

### NAICS 2022 ↔ ISIC ↔ NACE 2.1 ↔ NOGA 2025 crosswalk (Pro tier — 2026-04-30)

- \`naics_nace_crosswalk.{csv,json,sql,parquet}\` — **${input.naics!.rows.length}** mappings.
  Sourced from the U.S. Census Bureau \`2022 NAICS to ISIC Rev 4\` concordance and pivoted
  via ISIC Rev 4 to NACE 2.1 / NOGA 2025. Public Domain (US Government Work).
- \`naics_source.json\` — Census source URL, fetch metadata, license, attribution.

Use case: any buyer with US-side reporting (Salesforce NAICS field, Census filings,
North-American consolidation) gets an immediate join from Swiss/EU codes to NAICS.

\`mapping_type\`:
- \`exact\` — single ISIC class under the Census-listed group, no fan-out;
- \`partial\` — fan-out to multiple ISIC classes or Census flagged the link as partial.`
      : ""
  }${
    hasNaceEnLabels
      ? `

### NACE Rev 2.1 official English labels (Pro tier — 2026-04-30)

- \`nace_2_1_en_labels.{csv,json,parquet}\` — **${input.naceEnLabels!.length}** rows.
  Stand-alone projection of the EN labels parsed from the EU Vocabularies SKOS/XKOS RDF.
  Eurostat re-use policy applies (free for commercial use with attribution).

Use case: compliance officers and English-speaking analysts in international groups
who need the OFFICIAL Eurostat NACE labels in English without joining tables.`
      : ""
  }

### Metadata

- \`schema.json\` — JSON Schema (Draft-07)
- \`checksums.sha256\`
- \`provenance.json\` — Ed25519-signed manifest + RFC-3161 timestamp (verify with \`npx tsx etl/shared/verify-provenance.ts <zip>\`; public key at \`packages/schemas/openswissdata.pubkey.ed25519\`)
- \`LICENSE.txt\`
- \`README.md\` (this file)

## Sources

- **NOGA** — Federal Statistical Office (BFS/OFS), Switzerland. https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/nomenclatures/noga.html
- **NACE** — Eurostat Ramon. https://ec.europa.eu/eurostat/ramon/
- **ISIC** — United Nations Statistics Division. https://unstats.un.org/unsd/classifications/Econ/isic
${input.statent ? "- **STATENT** — BFS PX-Web JSON-stat2 API (px-x-0602010000_101 + _102). https://www.pxweb.bfs.admin.ch/" : ""}
${hasNaics ? "- **NAICS 2022 ↔ ISIC Rev 4 concordance** — U.S. Census Bureau (Public Domain — US Government Work). https://www.census.gov/naics/concordances/" : ""}
${hasEmbeddings ? "- **Embeddings model** — Xenova/paraphrase-multilingual-mpnet-base-v2 (Apache 2.0)" : ""}

## Mapping principle

- NOGA 2025 codes are identical to NACE Rev 2.1 at the class level (4-digit).
- NOGA 2008 codes are identical to NACE Rev 2.0 at the class level.
- The explicit bridges are NACE 2.0 ↔ 2.1 (Eurostat) and NACE 2.1 ↔ ISIC 4 (UN Stats).
- Cross-walks are anchored on NOGA 2025 classes. One NOGA 2025 class can produce multiple cross-walk rows if several NACE 2.0 or ISIC 4 codes match.

## Dataset metadata

- Bundle version: ${version}
- Generated: ${new Date().toISOString()}
- Tier: ${
    hasEmbeddings || hasNaics || hasNaceEnLabels || input.statent
      ? "Classifications Pro"
      : "Classifications Standard"
  }
`;
  writeFileSync(join(workDir, "README.md"), readme, "utf8");
  writeFileSync(join(workDir, "LICENSE.txt"), DATASET_LICENSE, "utf8");

  // Checksums
  const dataFiles = [
    "noga_2008.csv",
    "noga_2008.json",
    "noga_2008.sql",
    "noga_2025.csv",
    "noga_2025.json",
    "noga_2025.sql",
    "nace_2_0.csv",
    "nace_2_0.json",
    "nace_2_0.sql",
    "nace_2_1.csv",
    "nace_2_1.json",
    "nace_2_1.sql",
    "isic_4.csv",
    "isic_4.json",
    "isic_4.sql",
    "nomenclatures.parquet",
    "crosswalks.csv",
    "crosswalks.json",
    "crosswalks.sql",
    "crosswalks.parquet",
    "schema.json",
    ...statentFiles,
    ...embeddingFiles,
    ...naicsFiles,
    ...naceEnLabelsFiles,
  ];
  const checksums =
    dataFiles
      .map((f) => {
        const content = readFileSync(join(workDir, f));
        const hash = createHash("sha256").update(content).digest("hex");
        return `${hash}  ${f}`;
      })
      .join("\n") + "\n";
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
  const profile = PERMISSION_PROFILES.classifications;
  const provenance = await buildSignedProvenance({
    dataset: "classifications",
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
  const zipPath = join(outDir, `classifications-${version}.zip`);
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

  rmSync(workDir, { recursive: true, force: true });

  return {
    zipPath,
    sha256,
    sizeBytes,
    version,
    nomenclatureCount,
    crossWalkCount: input.crossWalks.length,
    statentRowCount: input.statent
      ? {
          canton_division: input.statent.cantonDivision.length,
          commune_sector: input.statent.communeSector.length,
        }
      : undefined,
    embeddingCount: hasEmbeddings ? input.embeddings!.length : undefined,
    embeddingCountByLang: hasEmbeddings ? embeddingCountByLang : undefined,
    naicsCrosswalkCount: hasNaics ? input.naics!.rows.length : undefined,
    naceEnLabelCount: hasNaceEnLabels ? input.naceEnLabels!.length : undefined,
  };
}
