import { mkdirSync, rmSync, existsSync, createWriteStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import { createHash } from "node:crypto";
import parquet from "parquetjs-lite";
import { writeCsv, writeJson, writeSqlInserts, writeParquet } from "../shared/formats.js";
import type { NomenclatureRow, CrossWalkRow, NomenclatureScheme } from "./types.js";

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

const DATASET_LICENSE = `openswissdata.com — Dataset License v1.0

Copyright © 2026 Alain Martin · openswissdata.com

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
Swiss law. For: canton of Alain Martin.

Contact: alain@openswissdata.com
`;

export interface ClassificationsBundleInput {
  rows: NomenclatureRow[];
  crossWalks: CrossWalkRow[];
}

export interface ClassificationsBundleResult {
  zipPath: string;
  sha256: string;
  sizeBytes: number;
  version: string;
  nomenclatureCount: Record<NomenclatureScheme, number>;
  crossWalkCount: number;
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

export async function buildBundle(
  input: ClassificationsBundleInput,
  version: string,
  outDir: string,
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
    },
  };
  writeJson(schema, join(workDir, "schema.json"));

  // README
  const readme = `# Swiss Economic Classifications Bundle — version ${version}

Normalized economic activity classifications for Swiss and international reporting:

- **NOGA 2008** — ${nomenclatureCount["NOGA_2008"]} rows
- **NOGA 2025** — ${nomenclatureCount["NOGA_2025"]} rows
- **NACE Rev 2** (2.0) — ${nomenclatureCount["NACE_2.0"]} rows
- **NACE Rev 2.1** — ${nomenclatureCount["NACE_2.1"]} rows
- **ISIC Rev 4** — ${nomenclatureCount["ISIC_4"]} rows
- **Cross-walks** — ${input.crossWalks.length} mappings (5-way NOGA↔NACE↔ISIC)

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

- \`crosswalks.{csv,json,sql,parquet}\` — one row per NOGA 2025 class linking to the 4 other standards

### Metadata

- \`schema.json\` — JSON Schema (Draft-07)
- \`checksums.sha256\`
- \`LICENSE.txt\`
- \`README.md\` (this file)

## Sources

- **NOGA** — Federal Statistical Office (BFS/OFS), Switzerland. https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/nomenclatures/noga.html
- **NACE** — Eurostat Ramon. https://ec.europa.eu/eurostat/ramon/
- **ISIC** — United Nations Statistics Division. https://unstats.un.org/unsd/classifications/Econ/isic

## Mapping principle

- NOGA 2025 codes are identical to NACE Rev 2.1 at the class level (4-digit).
- NOGA 2008 codes are identical to NACE Rev 2.0 at the class level.
- The explicit bridges are NACE 2.0 ↔ 2.1 (Eurostat) and NACE 2.1 ↔ ISIC 4 (UN Stats).
- Cross-walks are anchored on NOGA 2025 classes. One NOGA 2025 class can produce multiple cross-walk rows if several NACE 2.0 or ISIC 4 codes match.

## Dataset metadata

- Bundle version: ${version}
- Generated: ${new Date().toISOString()}
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

  return { zipPath, sha256, sizeBytes, version, nomenclatureCount, crossWalkCount: input.crossWalks.length };
}
