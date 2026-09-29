/**
 * Inventaire en lecture seule des effacements de conservation dus à cet instant (docs/conservation-des-donnees.md).
 * Base ouverte en lecture seule, aucune écriture, aucun réseau ; seuls des nombres sont affichés, jamais une adresse.
 * Usage : node dist/scripts/retention-preview.js [chemin de la base] (sinon DATABASE_PATH).
 */
import Database from 'better-sqlite3';
import { resolveDatabasePath } from '../lib/data-paths.js';
import { previewRetention } from '../lib/retention-rules.js';

const path = resolveDatabasePath(process.argv[2]);
if (path === ':memory:') {
  console.error('[conservation] chemin de base requis');
  process.exit(1);
}
const db = new Database(path, { readonly: true, fileMustExist: true });
try {
  db.pragma('query_only = ON');
  const now = Date.now();
  console.log(JSON.stringify({ checked_at: new Date(now).toISOString(), ...previewRetention(db, now) }));
} finally { db.close(); }
