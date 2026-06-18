/**
 * Regenerate web/src/data/dataset-versions.json from the live DB.
 *
 * The landing-page version badges (pastilles "vYYYY.MM.DD") import this
 * manifest at BUILD TIME. Running this script before a web rebuild keeps the
 * badges truthful and atomic with the data: they reflect the real
 * `datasets.current_version`, never a hand-typed date.
 *
 * Why a committed manifest (not a runtime fetch): the static web build does
 * not read the DB, and a live fetch could show a version AHEAD of the deployed
 * MCP/CSV data — reintroducing drift the other way. The manifest must move in
 * the same deploy as the data it describes.
 *
 * USAGE:
 *   DATABASE_PATH=/data/openswissdata.sqlite tsx scripts/sync-dataset-versions.ts
 *
 * Wire into the refresh workflows AFTER each ETL release, then commit + redeploy
 * so the badge tracks the freshest published version automatically.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDb } from "../src/lib/db.js";

const IDS = ["tares", "classifications", "finma"] as const;

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, "..", "web", "src", "data", "dataset-versions.json");

const db = getDb();
const rows = db
  .prepare(
    "SELECT id, current_version FROM datasets WHERE id IN ('tares','classifications','finma')",
  )
  .all() as Array<{ id: string; current_version: string | null }>;
const byId = new Map(rows.map((r) => [r.id, r.current_version]));

const versions: Record<string, string> = {};
for (const id of IDS) {
  const v = byId.get(id);
  if (!v) {
    console.error(`[sync:versions] missing current_version for "${id}" — aborting (manifest left unchanged)`);
    process.exit(1);
  }
  versions[id] = v;
}

const manifest = {
  _note:
    "Versions réelles des datasets, reflétées sur les pastilles de la landing. Généré par `npm run sync:versions` (scripts/sync-dataset-versions.ts) depuis datasets.current_version — NE PAS éditer la date à la main.",
  ...versions,
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`[sync:versions] wrote ${manifestPath}`);
console.log(`[sync:versions] tares=${versions.tares} classifications=${versions.classifications} finma=${versions.finma}`);
