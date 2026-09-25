import { mkdirSync, rmSync, existsSync, createWriteStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { stringify as csvStream } from "csv-stringify";
import parquet from "parquetjs-lite";
import { writeCsv, writeJson, writeSqlInserts, writeParquet } from "../shared/formats.js";
import { buildSignedProvenance, PERMISSION_PROFILES, type ProvenanceFile } from "../shared/provenance.js";
import type { DutyRateRow } from "./parse-bazg-xlsx.js";
import type { TaresRow } from "./types.js";
import {
  TARES_EMBEDDING_DIMENSIONS,
  TARES_EMBEDDING_MODEL,
  TARES_EMBEDDING_MODEL_VERSION,
  type TaresEmbedding,
} from "./embeddings.js";

const TARES_PARQUET_SCHEMA = new parquet.ParquetSchema({
  hs8: { type: "UTF8" },
  duty_rates_count: { type: "INT32", optional: true },
  hs6: { type: "UTF8" },
  chapter: { type: "INT32" },
  heading: { type: "UTF8" },
  designation_fr: { type: "UTF8" },
  designation_de: { type: "UTF8" },
  designation_it: { type: "UTF8" },
  designation_en: { type: "UTF8", optional: true },
  unit_stat: { type: "UTF8" },
  duty_mfn_value: { type: "DOUBLE", optional: true },
  duty_mfn_unit: { type: "UTF8", optional: true },
  duty_mfn_currency: { type: "UTF8", optional: true },
  preferential_regimes_json: { type: "UTF8" },
  restrictions_codes_json: { type: "UTF8" },
  customs_relief_codes_json: { type: "UTF8", optional: true },
  valid_from: { type: "UTF8" },
  source_url: { type: "UTF8" },
});

// Embeddings parquet schema. We use FLOAT (32-bit) instead of DOUBLE (64-bit):
// the model's native precision is float32 and we save 50% on disk for free.
// `repeated: true` declares a Parquet REPEATED column = list<float>.
const TARES_EMBEDDINGS_PARQUET_SCHEMA = new parquet.ParquetSchema({
  hs_code: { type: "UTF8" },
  lang: { type: "UTF8" },
  description: { type: "UTF8" },
  embedding: { type: "FLOAT", repeated: true },
  model: { type: "UTF8" },
  model_version: { type: "UTF8" },
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
      duty_rates_count: { type: "integer", minimum: 0 },
      hs8: { type: "string", pattern: "^[0-9]{8}$" },
      hs6: { type: "string", pattern: "^[0-9]{6}$" },
      chapter: { type: "integer", minimum: 1, maximum: 99 },
      heading: { type: "string" },
      designation_fr: { type: "string" },
      designation_de: { type: "string" },
      designation_it: { type: "string" },
      designation_en: { type: "string" },
      unit_stat: { type: "string" },
      duty_mfn_value: { type: ["number", "null"] },
      duty_mfn_unit: { type: ["string", "null"] },
      duty_mfn_currency: { type: ["string", "null"] },
      preferential_regimes: { type: "object", additionalProperties: { oneOf: [{ type: "number" }, { const: "free" }] } },
      restrictions_codes: { type: "array", items: { type: "string" } },
      customs_relief_codes: { type: "array", items: { type: "string" } },
      valid_from: { type: "string", format: "date" },
      source_url: { type: "string", format: "uri" },
    },
  },
};

const DATASET_LICENSE = `openswissdata.com — TARES Dataset License v1.0

Copyright © 2026 Claude-Alain Martin · openswissdata.com

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

Contact: contact@openswissdata.com · Source: https://xtares.admin.ch/
`;

export interface BundleResult {
  zipPath: string;
  sha256: string;
  sizeBytes: number;
  version: string;
  rowCount: number;
  lastUpdatedAt: string; // ISO timestamp for BAZG traceability
}

export interface BuildBundleOptions {
  /**
   * If false, skip the RFC-3161 timestamp call. Used in tests so they don't
   * depend on freetsa.org. Defaults to `true` in production releases.
   */
  withTimestamp?: boolean;
  /**
   * Optional pre-computed embeddings (one row per HS8 × lang). When provided,
   * a `tares_embeddings.parquet` file is added to the bundle, listed in
   * `checksums.sha256` and covered by the signed provenance manifest.
   *
   * If `undefined`, the bundle is built WITHOUT embeddings — for backwards
   * compatibility with releases predating Phase 1 / T1 (and to keep tests fast).
   */
  embeddings?: TaresEmbedding[];
  rates?: DutyRateRow[];
  quality?: Record<string, unknown>;
  sources?: unknown;
}

export async function buildBundle(
  rows: TaresRow[],
  version: string,
  outDir: string,
  opts: BuildBundleOptions = {},
): Promise<BundleResult> {
  const workDir = join(outDir, `tares-${version}-work`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const profile = PERMISSION_PROFILES.tares;

  // CSV — flatten nested fields to JSON strings for CSV compatibility
  const flatRows = rows.map(r => ({
    ...r,
    preferential_regimes: JSON.stringify(r.preferential_regimes),
    restrictions_codes: JSON.stringify(r.restrictions_codes),
    customs_relief_codes: r.customs_relief_codes ? JSON.stringify(r.customs_relief_codes) : "",
  }));
  writeCsv(flatRows, join(workDir, "tares.csv"));

  // Parquet — map to schema-compatible shape (rename nested fields)
  const parquetRows = rows.map(r => ({
    hs8: r.hs8,
    duty_rates_count: r.duty_rates_count,
    hs6: r.hs6,
    chapter: r.chapter,
    heading: r.heading,
    designation_fr: r.designation_fr,
    designation_de: r.designation_de,
    designation_it: r.designation_it,
    designation_en: r.designation_en,
    unit_stat: r.unit_stat,
    duty_mfn_value: r.duty_mfn_value,
    duty_mfn_unit: r.duty_mfn_unit,
    duty_mfn_currency: r.duty_mfn_currency,
    preferential_regimes_json: JSON.stringify(r.preferential_regimes),
    restrictions_codes_json: JSON.stringify(r.restrictions_codes),
    customs_relief_codes_json: r.customs_relief_codes ? JSON.stringify(r.customs_relief_codes) : undefined,
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

  // Embeddings parquet (Phase 1 / T1) — only when caller supplied them.
  // We rely on the caller (release.ts) to have already paid the inference cost.
  const hasEmbeddings = !!opts.embeddings && opts.embeddings.length > 0;
  if (hasEmbeddings) {
    const embeddingRows = opts.embeddings!.map((e) => ({
      hs_code: e.hs_code,
      lang: e.lang,
      description: e.description,
      embedding: e.embedding,
      model: e.model,
      model_version: e.model_version,
    }));
    await writeParquet(
      embeddingRows as Record<string, unknown>[],
      TARES_EMBEDDINGS_PARQUET_SCHEMA,
      join(workDir, "tares_embeddings.parquet"),
    );
  }

  // Les lignes détaillées restent séparées : une ligne par condition et unité BAZG.
  if (opts.rates) {
    // Écriture en flux : le détail complet ne doit pas devenir une chaîne géante en mémoire.
    const rates = function* () {
      for (const r of opts.rates!) yield { hs8: r.hs8, valid_from: r.validFrom, valid_to: r.validTo, source_file: r.source_file, ...r.source_record };
    };
    const json = function* () {
      yield "[\n"; let first = true;
      for (const row of rates()) { yield (first ? "" : ",\n") + JSON.stringify(row); first = false; }
      yield "\n]\n";
    };
    await pipeline(Readable.from(json()), createWriteStream(join(workDir, "tares_rates.json")));
    await pipeline(Readable.from(rates()), csvStream({ header: true }), createWriteStream(join(workDir, "tares_rates.csv")));
  }
  if (opts.quality) writeJson(opts.quality, join(workDir, "quality.json"));
  if (opts.sources) writeJson(opts.sources, join(workDir, "sources.json"));

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

Swiss customs tariff codes (HS8), normalized into a summary and a detailed rate table.
${opts.rates ? `
## Lecture des taux — schéma 2

- \`tares_rates.json\` / \`tares_rates.csv\` conservent chaque ligne de taux en vigueur et ses cellules source, avec les noms de colonnes BAZG : code LDG, ZCO, séquence, unité, validité et conditions. Les colonnes ajoutées hs8, valid_from, valid_to et source_file facilitent la jointure et la traçabilité ; les dates source Excel restent présentes.
- Le résumé MFN retient uniquement un taux de base non ambigu (ZCO 00, séquence 1, sans texte conditionnel). Aucune sélection du taux le plus bas.
- Le résumé préférentiel n'inclut que les groupes sans variantes conditionnelles, avec la même unité que le résumé MFN. Une absence ne signifie jamais gratuité. Les clés connues sont eu/efta/uk/cn/jp/tr ; les autres gardent leur identifiant ldg_<code>.
- Dans le détail, \`ANS Einheit\` conserve l'unité source (Fr. ou %). Un pourcentage n’est jamais converti en CHF ; sa base doit être vérifiée dans la source.
- Les préférences restent soumises à l'origine et aux conditions douanières : ce fichier n'est pas un calculateur de dédouanement. Vérifier sur xtares.admin.ch.
- \`unit_stat\` est conservé pour compatibilité comme ancien alias de l'unité du droit, pas une unité statistique autonome.
- Les changements portent sur les champs communs avec la version précédente ; l'ajout des détails n'est pas un changement tarifaire en soi.
` : ""}

## Files

- \`tares.csv\` — UTF-8 comma-separated
- \`tares.parquet\` — Apache Parquet
- \`tares.json\` — hierarchical JSON (all nested fields preserved)
- \`tares.sql\` — CREATE TABLE + INSERT statements (PostgreSQL/MySQL/SQLite compatible)
- \`schema.json\` — JSON Schema (Draft-07)${opts.rates ? "\n- `tares_rates.csv` et `tares_rates.json` — taux détaillés et cellules source" : ""}${opts.quality ? "\n- `quality.json` — contrôles et changements observés" : ""}${opts.sources ? "\n- `sources.json` — provenance des sept sources" : ""}${hasEmbeddings ? `
- \`tares_embeddings.parquet\` — pre-computed semantic embeddings of French descriptions.
  Columns: \`hs_code\`, \`lang\`, \`description\`, \`embedding\` (list<float>, ${TARES_EMBEDDING_DIMENSIONS}d),
  \`model\` (\`${TARES_EMBEDDING_MODEL}\`), \`model_version\` (\`${TARES_EMBEDDING_MODEL_VERSION}\`).
  Vectors are L2-normalised so cosine similarity reduces to a dot product.
  The lang column identifies the language actually encoded.` : ""}
- \`checksums.sha256\`
- \`provenance.json\` — Ed25519-signed manifest + RFC-3161 timestamp (see "Provenance" below)
- \`LICENSE.txt\`

## Provenance & verification

\`provenance.json\` proves the integrity, origin, and non-back-datable issuance
of this bundle. It contains:

- BAZG permission reference (\`${profile.permissionReference}\`) granted ${profile.permissionDate}
- SHA-256 of every shipped file
- An Ed25519 signature over a canonical JSON serialization (sorted keys,
  no whitespace) of the manifest **without** the \`signature\` and
  \`timestamp_authority\` fields
- An RFC-3161 timestamp token (DER, base64-encoded) from a public TSA

To verify:

\`\`\`
npx tsx etl/shared/verify-provenance.ts <this-zip>
\`\`\`

The public key is committed at
\`packages/schemas/openswissdata.pubkey.ed25519\` (PEM SPKI). Any third-party
tool that supports Ed25519 (openssl ≥ 1.1.1, libsodium, etc.) can verify the
signature without trusting this code.

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

  // Compute checksums of the data files (NOT README/LICENSE/checksums itself).
  // CRITICAL: every file in this list is covered by:
  //   1. checksums.sha256 (line-per-file digest)
  //   2. provenance.json `manifest.files[]` (Ed25519-signed)
  // If you add a file to the bundle, add it here too — otherwise a buyer can
  // tamper with it and the signature will still validate.
  const dataFiles = [
    "tares.csv",
    "tares.parquet",
    "tares.json",
    "tares.sql",
    "schema.json",
    ...(opts.rates ? ["tares_rates.json", "tares_rates.csv"] : []),
    ...(opts.quality ? ["quality.json"] : []),
    ...(opts.sources ? ["sources.json"] : []),
    ...(hasEmbeddings ? ["tares_embeddings.parquet"] : []),
  ];
  const checksums = dataFiles.map(f => {
    const content = readFileSync(join(workDir, f));
    const hash = createHash("sha256").update(content).digest("hex");
    return `${hash}  ${f}`;
  }).join("\n") + "\n";
  writeFileSync(join(workDir, "checksums.sha256"), checksums, "utf8");

  // Provenance manifest (signed Ed25519 + RFC-3161 timestamp).
  // Covers data files + README + LICENSE + checksums.sha256 (transitive integrity).
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
    dataset: "tares",
    version,
    sourceUrl: profile.sourceUrl,
    files: manifestFiles,
    permissionReference: profile.permissionReference,
    permissionAuthority: profile.permissionAuthority,
    permissionDate: profile.permissionDate,
    jurisdiction: profile.jurisdiction,
    withTimestamp: opts.withTimestamp,
  });
  writeFileSync(join(workDir, "provenance.json"), JSON.stringify(provenance, null, 2), "utf8");

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
