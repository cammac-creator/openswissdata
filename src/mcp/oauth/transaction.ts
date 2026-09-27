import {getDb, SQLITE_BUSY_TIMEOUT_MS} from '../../lib/db.js';

/** Transaction synchrone : un verrou ne doit pas suspendre la boucle HTTP pendant cinq secondes. */
export function oauthWrite<T>(work: () => T): T {
  const db = getDb();
  try {
    db.pragma('busy_timeout = 0');
    return db.transaction(work).immediate();
  } finally {
    try { if (db.open) db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`); }
    catch { console.warn('[oauth] réglage SQLite non restauré'); }
  }
}
