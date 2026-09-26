// Copie restaurée isolée → preuve minimale, sans migration ni lecture de lignes clients.
import Database from 'better-sqlite3';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const BACKUP_CHECK_ERRORS = ['backup_bytes_differ', 'backup_integrity_failed', 'backup_foreign_keys_failed', 'backup_schema_failed', 'backup_versions_failed', 'backup_inspection_failed', 'backup_inspection_timeout'] as const;
export type BackupCheckError = typeof BACKUP_CHECK_ERRORS[number];
export type BackupInspection = {
  version: 1; byte_match: true; integrity: 'ok'; foreign_keys: 'ok'; required_schema: 'ok'; current_versions: 'ok'; duration_ms: number;
};
export class BackupInspectionError extends Error {
  constructor(readonly code: BackupCheckError) { super(code); }
}
async function fingerprint(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function inspectRestoredBackup(snapshotPath: string, restoredPath: string): Promise<BackupInspection> {
  const started = Date.now();
  if (await fingerprint(snapshotPath) !== await fingerprint(restoredPath)) throw new BackupInspectionError('backup_bytes_differ');
  const db = new Database(restoredPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new BackupInspectionError('backup_integrity_failed');
    if (db.prepare('PRAGMA foreign_key_check').get()) throw new BackupInspectionError('backup_foreign_keys_failed');
    try {
      // LIMIT 0 vérifie les colonnes dont la reprise a besoin, sans extraire les personnes ou leurs achats.
      for (const sql of [
        'SELECT id,current_version FROM datasets LIMIT 0',
        'SELECT dataset_id,version,r2_key,sha256,size_bytes FROM versions LIMIT 0',
        'SELECT id,email,locale FROM customers LIMIT 0',
        'SELECT id,customer_id,stripe_session_id,status,items_json FROM orders LIMIT 0',
        'SELECT customer_id,dataset_id,order_id FROM entitlements LIMIT 0',
        'SELECT order_id,dataset_id FROM order_grants LIMIT 0',
        'SELECT order_id,status,terms_version,document_sha256 FROM order_legal LIMIT 0',
        'SELECT order_id,state,next_attempt_at FROM order_deliveries LIMIT 0',
        'SELECT token,customer_id,expires_at FROM sessions LIMIT 0',
      ]) db.prepare(sql).all();
    } catch { throw new BackupInspectionError('backup_schema_failed'); }
    if (db.prepare('SELECT 1 FROM datasets d WHERE d.current_version IS NOT NULL AND NOT EXISTS (SELECT 1 FROM versions v WHERE v.dataset_id=d.id AND v.version=d.current_version) LIMIT 1').get()) {
      throw new BackupInspectionError('backup_versions_failed');
    }
    return { version: 1, byte_match: true, integrity: 'ok', foreign_keys: 'ok', required_schema: 'ok', current_versions: 'ok', duration_ms: Date.now() - started };
  } finally { db.close(); }
}

// Le processus séparé ne charge ni l’application, ni les secrets, ni un client réseau.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await inspectRestoredBackup(process.argv[2], process.argv[3]))); }
  catch (error) {
    process.stdout.write(JSON.stringify({ error: error instanceof BackupInspectionError ? error.code : 'backup_inspection_failed' }));
    process.exitCode = 1;
  }
}
