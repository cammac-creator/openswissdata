import { mkdirSync, rmSync, existsSync, createWriteStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import { createHash } from "node:crypto";
import parquet from "parquetjs-lite";
import { writeCsv, writeJson, writeSqlInserts, writeParquet } from "../shared/formats.js";
import type { FinmaEntity, FinmaEntityType } from "./types.js";
import type { DeltaChange } from "./delta.js";

const FINMA_PARQUET_SCHEMA = new parquet.ParquetSchema({
  entity_type: { type: "UTF8" },
  name: { type: "UTF8" },
  uid: { type: "UTF8", optional: true },
  lei: { type: "UTF8", optional: true },
  licence_type: { type: "UTF8", optional: true },
  licence_date: { type: "UTF8", optional: true },
  status: { type: "UTF8", optional: true },
  canton: { type: "UTF8", optional: true },
  address: { type: "UTF8", optional: true },
  source_list: { type: "UTF8" },
  source_url: { type: "UTF8" },
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
"Data provided by openswissdata.com (source: FINMA — Swiss Financial Market Supervisory Authority)"

WARRANTY:
Provided "AS IS" without warranty. Data is normalized from official FINMA lists.
openswissdata.com is not responsible for errors in the underlying official sources.

LIABILITY:
Liability capped at the purchase price of this dataset.

GOVERNING LAW:
Swiss law. For: canton of Alain Martin.

Contact: alain@openswissdata.com
`;

export interface FinmaBundleInput {
  entities: FinmaEntity[];
  recentChanges?: DeltaChange[]; // 90-day delta, optional
}

export interface FinmaBundleResult {
  zipPath: string;
  sha256: string;
  sizeBytes: number;
  version: string;
  entityCount: number;
  countByType: Record<FinmaEntityType, number>;
  changeCount: number;
}

function toCsvRow(e: FinmaEntity): Record<string, unknown> {
  return {
    entity_type: e.entity_type,
    name: e.name,
    uid: e.uid ?? "",
    lei: e.lei ?? "",
    licence_type: e.licence_type ?? "",
    licence_date: e.licence_date ?? "",
    status: e.status ?? "",
    canton: e.canton ?? "",
    address: e.address ?? "",
    source_list: e.source_list,
    source_url: e.source_url,
  };
}

function deltaToCsvRow(c: DeltaChange): Record<string, unknown> {
  return {
    kind: c.kind,
    entity_type: c.entity_type,
    name: c.name,
    uid: c.uid ?? "",
    source_list: c.source_list,
    before: c.before ? JSON.stringify(c.before) : "",
    after: c.after ? JSON.stringify(c.after) : "",
  };
}

export async function buildBundle(input: FinmaBundleInput, version: string, outDir: string): Promise<FinmaBundleResult> {
  const workDir = join(outDir, `finma-${version}-work`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const countByType = {} as Record<FinmaEntityType, number>;
  const entityTypes: FinmaEntityType[] = [
    "bank", "insurance", "asset_manager_collective", "asset_manager_individual",
    "securities_firm", "fund_representative", "payment_institution",
    "sro_member", "supervisory_org", "insurance_intermediary",
  ];
  for (const t of entityTypes) countByType[t] = 0;
  for (const e of input.entities) countByType[e.entity_type] = (countByType[e.entity_type] ?? 0) + 1;

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
    licence_type: e.licence_type,
    licence_date: e.licence_date,
    status: e.status,
    canton: e.canton,
    address: e.address,
    source_list: e.source_list,
    source_url: e.source_url,
  }));
  await writeParquet(parquetRows as Record<string, unknown>[], FINMA_PARQUET_SCHEMA, join(workDir, "finma_registry.parquet"));

  // Per-type CSV files for granular consumption
  for (const t of entityTypes) {
    const filtered = csvRows.filter(r => r.entity_type === t);
    if (filtered.length > 0) {
      writeCsv(filtered, join(workDir, `finma_${t}.csv`));
    }
  }

  // Changelog (90-day delta) — write even if empty
  const changes = input.recentChanges ?? [];
  writeCsv(changes.map(deltaToCsvRow), join(workDir, "changelog_90d.csv"));
  writeJson(changes, join(workDir, "changelog_90d.json"));

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
      },
    },
  };
  writeJson(schema, join(workDir, "schema.json"));

  // README
  const readme = `# FINMA Registry Dataset — version ${version}

Unified registry of financial institutions authorised by FINMA (Swiss Financial Market Supervisory Authority).
${input.entities.length} entities across ${entityTypes.length} entity types.

## Files

### Unified registry (all entity types)

- \`finma_registry.csv\` — UTF-8 comma-separated
- \`finma_registry.json\` — JSON array
- \`finma_registry.sql\` — CREATE TABLE + INSERT statements
- \`finma_registry.parquet\` — Apache Parquet (columnar)

### Per entity type (CSV only)

${entityTypes.map(t => `- \`finma_${t}.csv\` — ${countByType[t] ?? 0} entries`).join("\n")}

### Delta

- \`changelog_90d.{csv,json}\` — changes vs the last snapshot (additions, removals, status/address/licence changes)

### Metadata

- \`schema.json\` — JSON Schema (Draft-07)
- \`checksums.sha256\`
- \`LICENSE.txt\`

## Attribution

Source: Swiss Financial Market Supervisory Authority (FINMA). https://www.finma.ch/

## Dataset metadata

- Entities: ${input.entities.length}
- Changes in last snapshot: ${changes.length}
- Version: ${version}
- Generated: ${new Date().toISOString()}
`;
  writeFileSync(join(workDir, "README.md"), readme, "utf8");
  writeFileSync(join(workDir, "LICENSE.txt"), DATASET_LICENSE, "utf8");

  // Checksums of data files (exclude README/LICENSE/checksums themselves)
  const dataFiles = [
    "finma_registry.csv", "finma_registry.json", "finma_registry.sql", "finma_registry.parquet",
    ...entityTypes.filter(t => countByType[t] > 0).map(t => `finma_${t}.csv`),
    "changelog_90d.csv", "changelog_90d.json",
    "schema.json",
  ];
  const checksums = dataFiles.map(f => {
    const content = readFileSync(join(workDir, f));
    const hash = createHash("sha256").update(content).digest("hex");
    return `${hash}  ${f}`;
  }).join("\n") + "\n";
  writeFileSync(join(workDir, "checksums.sha256"), checksums, "utf8");

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

  rmSync(workDir, { recursive: true, force: true });

  return { zipPath, sha256, sizeBytes, version, entityCount: input.entities.length, countByType, changeCount: changes.length };
}
