// Or SQLite et bronze technique → expiration et témoin minimal ; achats et droits conservés.
/**
 * Cleanup expired ephemeral rows.
 *
 * Without this, the SQLite file grows monotonically:
 *  - sessions:        Max-Age 30d cookies → rows survive 30d after creation
 *  - magic_links:     15-min TTL but never deleted on expiration
 *  - download_tokens: 48h TTL but never deleted on expiration
 *  - mcp_oauth_codes: short TTL, accumulate
 *  - request_log:     audit log, but only useful for ~30d
 *
 * Idempotent. Safe to run hourly.
 *
 * Two ways to run:
 *  1. Locally / Railway shell:  tsx scripts/cleanup-expired.ts
 *  2. Cron via GitHub Actions:  POST /api/admin/cleanup-expired (see workflow)
 *
 * The second path is the production one — GitHub Actions runners cannot reach
 * the Railway DB volume directly, so we expose `runCleanup()` as a function
 * the admin endpoint calls.
 */

import { getDb, closeDb } from "../src/lib/db.js";
import { runFullCleanup } from "../src/lib/cleanup.js";
import { resolveDatabasePath } from '../src/lib/data-paths.js';

async function main() {
  try {
    if (resolveDatabasePath() === ':memory:') throw new Error('database_path_required');
    const result = await runFullCleanup(getDb(undefined, { fileMustExist: true }));
    for (const entry of result.entries) {
      const detail = entry.status === 'error' ? `ÉCHEC ${entry.error}` : entry.status === 'not_applicable' ? 'table historique absente' : `${entry.deleted} éléments retirés (${entry.unit})`;
      console.log(`[nettoyage] ${entry.name} : ${detail}`);
    }
    console.log(`[nettoyage] ${result.ok ? 'Terminé' : 'INCOMPLET'} ; total : ${result.totalDeleted}.`);
    if (!result.ok) process.exitCode = 1;
  } finally { closeDb(); }
}
main().catch(() => { console.error('[nettoyage] Échec du passage ; aucun succès déclaré.'); process.exitCode = 1; });
