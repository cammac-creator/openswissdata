import { mkdirSync, rmSync, existsSync, createWriteStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import { createHash } from "node:crypto";
import parquet from "parquetjs-lite";
import { writeCsv, writeJson, writeSqlInserts, writeParquet } from "../shared/formats.js";
import type { TaresRow } from "./types.js";

const TARES_PARQUET_SCHEMA = new parquet.ParquetSchema({
  hs8: { type: "UTF8" },
  hs6: { type: "UTF8" },
  chapter: { type: "INT32" },
  heading: { type: "UTF8" },
  designation_fr: { type: "UTF8" },
  designation_de: { type: "UTF8" },
  designation_it: { type: "UTF8" },
  designation_en: { type: "UTF8", optional: true },
  unit_stat: { type: "UTF8" },
  duty_mfn_chf_per_100kg: { type: "DOUBLE", optional: true },
  preferential_regimes_json: { type: "UTF8" },
  restrictions_codes_json: { type: "UTF8" },
  valid_from: { type: "UTF8" },
  source_url: { type: "UTF8" },
});

const TARES_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "TARES Dataset",
  description: "Swiss customs tariff codes (HS8) normalized",
  type: "array",
  items: {
    type: "object",
    required: ["hs8", "hs6", "chapter", "heading", "designation_fr", "designation_de", "designation_it", "unit_stat", "valid_from", "source_url"],
    properties: {
      hs8: { type: "string", pattern: "^[0-9]{8}$" },
      hs6: { type: "string", pattern: "^[0-9]{6}$" },
      chapter: { type: "integer", minimum: 1, maximum: 99 },
      heading: { type: "string" },
      designation_fr: { type: "string" },
      designation_de: { type: "string" },
      designation_it: { type: "string" },
      designation_en: { type: "string" },
      unit_stat: { type: "string" },
      duty_mfn_chf_per_100kg: { type: ["number", "null"] },
      preferential_regimes: { type: "object", additionalProperties: { oneOf: [{ type: "number" }, { const: "free" }] } },
      restrictions_codes: { type: "array", items: { type: "string" } },
      valid_from: { type: "string", format: "date" },
      source_url: { type: "string", format: "uri" },
    },
  },
};

const DATASET_LICENSE = `openswissdata.com — TARES Dataset License v1.0

Copyright © 2026 Alain Martin · openswissdata.com

═══════════════════════════════════════════════════════════════════
OFFICIAL NOTICE — NON-OFFICIAL PUBLICATION / NICHT-OFFIZIELL / PUBLICATION NON OFFICIELLE
═══════════════════════════════════════════════════════════════════

DE: Dies ist keine offizielle Veröffentlichung. Massgebend sind allein die Veröffentlichungen durch die Bundeskanzlei und das Bundesamt für Zoll- und Grenzsicherheit BAZG.

FR: Ceci n'est pas une publication officielle. Seules les publications de la Chancellerie fédérale et de l'Office fédéral de la douane et de la sécurité des frontières BAZG font foi.

EN: This is not an official publication. Only the publications of the Federal Chancellery and the Federal Office for Customs and Border Security (FOCBS) are authoritative.

═══════════════════════════════════════════════════════════════════
LICENSE
═══════════════════════════════════════════════════════════════════

This dataset is licensed, not sold.

PERMITTED USES:
- Commercial use within your organization
- Derivation and transformation of FORM (format, encoding, indexing) ONLY
- Integration into your products or services (without redistributing the raw dataset)

PROHIBITED USES:
- Modification of the data CONTENT (tariff codes, duties, preferential regimes, designations must not be altered)
- Public redistribution of the dataset or substantial portions thereof
- Resale of the dataset in original or modified form
- Use of "Gebrauchszolltarif", "Tares", or similar denominations in a way that suggests this is an official BAZG publication
- Redistribution of BAZG Erläuterungen (explanatory notes) or Entscheide (classification decisions) — these are excluded from this dataset by design
- Use of BAZG logos, headers, or official branding

ATTRIBUTION:
Mandatory attribution in any derived product: the disclaimer above (DE/FR/EN) must be displayed verbatim, and users should be directed to https://xtares.admin.ch/ as the authoritative source.

WARRANTY:
The Federal Office for Customs and Border Security (BAZG) provides NO warranty, NO support, and NO interpretation assistance for this data. Errors arising from the use of this dataset or its derivatives cannot be invoked against customs clearance, duty collection, or criminal proceedings.
openswissdata.com provides this dataset AS-IS with no warranty of accuracy or fitness for purpose.

LIABILITY:
Liability capped at the purchase price of this dataset. No liability for indirect, consequential, or incidental damages.

GOVERNING LAW:
Swiss law. Jurisdiction: Bern (for TARES-related disputes specifically, per BAZG requirement 2026-04-21).

TERMINATION:
License terminates automatically upon breach of any prohibited use.

Contact: alain@openswissdata.com · Source: https://xtares.admin.ch/
`;

export interface BundleResult {
  zipPath: string;
  sha256: string;
  sizeBytes: number;
  version: string;
  rowCount: number;
  lastUpdatedAt: string; // ISO timestamp for BAZG traceability
}

export async function buildBundle(rows: TaresRow[], version: string, outDir: string): Promise<BundleResult> {
  const workDir = join(outDir, `tares-${version}-work`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // CSV — flatten nested fields to JSON strings for CSV compatibility
  const flatRows = rows.map(r => ({
    ...r,
    preferential_regimes: JSON.stringify(r.preferential_regimes),
    restrictions_codes: JSON.stringify(r.restrictions_codes),
  }));
  writeCsv(flatRows, join(workDir, "tares.csv"));

  // Parquet — map to schema-compatible shape (rename nested fields)
  const parquetRows = rows.map(r => ({
    hs8: r.hs8,
    hs6: r.hs6,
    chapter: r.chapter,
    heading: r.heading,
    designation_fr: r.designation_fr,
    designation_de: r.designation_de,
    designation_it: r.designation_it,
    designation_en: r.designation_en,
    unit_stat: r.unit_stat,
    duty_mfn_chf_per_100kg: r.duty_mfn_chf_per_100kg,
    preferential_regimes_json: JSON.stringify(r.preferential_regimes),
    restrictions_codes_json: JSON.stringify(r.restrictions_codes),
    valid_from: r.valid_from,
    source_url: r.source_url,
  }));
  await writeParquet(parquetRows as Record<string, unknown>[], TARES_PARQUET_SCHEMA, join(workDir, "tares.parquet"));

  // JSON (hierarchical / full)
  writeJson(rows, join(workDir, "tares.json"));

  // SQL
  writeSqlInserts("tares", flatRows, join(workDir, "tares.sql"));

  // JSON Schema
  writeJson(TARES_JSON_SCHEMA, join(workDir, "schema.json"));

  // README
  const lastUpdatedAt = new Date().toISOString();
  const readme = `# TARES Dataset — version ${version}

═══════════════════════════════════════════════════════════════════
🇩🇪 **Dies ist keine offizielle Veröffentlichung.** Massgebend sind allein die Veröffentlichungen durch die Bundeskanzlei und das Bundesamt für Zoll- und Grenzsicherheit BAZG.

🇫🇷 **Ceci n'est pas une publication officielle.** Seules les publications de la Chancellerie fédérale et de l'Office fédéral de la douane et de la sécurité des frontières BAZG font foi.

🇬🇧 **This is not an official publication.** Only the publications of the Federal Chancellery and the Federal Office for Customs and Border Security (FOCBS) are authoritative.

Authoritative source: https://xtares.admin.ch/
═══════════════════════════════════════════════════════════════════

Last updated: ${lastUpdatedAt}

Normalized (form only) Swiss customs tariff codes (HS8). Values are preserved verbatim from the authoritative source.

## Files

- \`tares.csv\` — UTF-8 comma-separated
- \`tares.parquet\` — Apache Parquet
- \`tares.json\` — hierarchical JSON (all nested fields preserved)
- \`tares.sql\` — CREATE TABLE + INSERT statements (PostgreSQL/MySQL/SQLite compatible)
- \`schema.json\` — JSON Schema (Draft-07)
- \`checksums.sha256\`
- \`LICENSE.txt\`

## Attribution

Source: Federal Office for Customs and Border Security (FOCBS / BAZG).
https://www.bazg.admin.ch/

## Dataset metadata

- Rows: ${rows.length}
- Version: ${version}
- Generated: ${lastUpdatedAt}
`;
  writeFileSync(join(workDir, "README.md"), readme, "utf8");

  // LICENSE.txt
  writeFileSync(join(workDir, "LICENSE.txt"), DATASET_LICENSE, "utf8");

  // Compute checksums of the 5 data files (NOT README/LICENSE/checksums itself)
  const dataFiles = ["tares.csv", "tares.parquet", "tares.json", "tares.sql", "schema.json"];
  const checksums = dataFiles.map(f => {
    const content = readFileSync(join(workDir, f));
    const hash = createHash("sha256").update(content).digest("hex");
    return `${hash}  ${f}`;
  }).join("\n") + "\n";
  writeFileSync(join(workDir, "checksums.sha256"), checksums, "utf8");

  // ZIP
  const zipPath = join(outDir, `tares-${version}.zip`);
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

  // Clean workDir to save space
  rmSync(workDir, { recursive: true, force: true });

  return { zipPath, sha256, sizeBytes, version, rowCount: rows.length, lastUpdatedAt };
}
