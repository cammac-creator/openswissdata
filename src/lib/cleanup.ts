// Or SQLite et bronze technique chiffré → expiration contrôlée ; aucune suppression des achats ou droits.
import type Database from 'better-sqlite3';
import { bronzePath } from './data-paths.js';
import { purgeExpiredBronze } from './bronze-retention.js';
import { invalidateBronzeUsage } from './crm-source.js';
import type { CleanupEntry, CleanupResult, CleanupProof } from './cleanup-types.js';
import { CLEANUP_CATEGORIES } from './cleanup-types.js';
import { z } from 'zod';
import { EVENT_RETENTION_MS } from './event-retention.js';
export type { CleanupEntry, CleanupResult } from './cleanup-types.js';

const DAY = 86_400_000;
const running = new WeakMap<Database.Database, Promise<CleanupProof>>();

export function runCleanup(db: Database.Database, now = Date.now()): CleanupResult {
  const entries: CleanupEntry[] = [];
  const plans: Array<{ name: CleanupEntry['name']; sql: string; cutoff: number; optional?: boolean; unit?: CleanupEntry['unit'] }> = [
    // Les liens de connexion actuels sont dans sessions ; conserver la purge de l’ancienne table si elle existe.
    { name: 'magic_links', sql: 'DELETE FROM magic_links WHERE expires_at < ?', cutoff: now, optional: true },
    { name: 'auth_request_limits', sql: 'DELETE FROM auth_request_limits WHERE expires_at <= ?', cutoff: now, optional: true },
    { name: 'sessions', sql: 'DELETE FROM sessions WHERE expires_at < ?', cutoff: now },
    { name: 'download_tokens', sql: 'DELETE FROM download_tokens WHERE expires_at < ?', cutoff: now },
    { name: 'mcp_oauth_codes', sql: 'DELETE FROM mcp_oauth_codes WHERE expires_at < ?', cutoff: now },
    // Table historique absente du schéma actuel : son absence seule est normale, pas une erreur SQL quelconque.
    { name: 'request_log', sql: 'DELETE FROM request_log WHERE timestamp < ?', cutoff: now - 30 * DAY, optional: true },
    { name: 'events', sql: 'DELETE FROM events WHERE ts < ?', cutoff: now - EVENT_RETENTION_MS },
    { name: 'download_activity', sql: 'DELETE FROM download_activity WHERE created_at < ?', cutoff: now - 180 * DAY },
    { name: 'delivery_message_references', sql: 'UPDATE order_deliveries SET provider_message_id=NULL WHERE provider_message_id IS NOT NULL AND COALESCE(sent_at,created_at) < ?', cutoff: now - 180 * DAY, unit: 'references' },
  ];
  for (const plan of plans) {
    const unit = plan.unit ?? 'rows';
    try {
      if (plan.optional && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(plan.name)) {
        entries.push({ name: plan.name, deleted: 0, status: 'not_applicable', unit });
        continue;
      }
      const table = plan.name === 'delivery_message_references' ? 'order_deliveries' : plan.name;
      const clock = plan.name === 'request_log' ? 'timestamp' : plan.name === 'events' ? 'ts' : plan.name === 'download_activity' ? 'created_at' : plan.name === 'delivery_message_references' ? 'COALESCE(sent_at,created_at)' : 'expires_at';
      const scope = plan.name === 'delivery_message_references' ? 'provider_message_id IS NOT NULL AND ' : '';
      // Toutes les dates produites par cette application sont des entiers en millisecondes.
      // Une table historique en secondes ou en texte est conservée pour examen, jamais vidée par erreur.
      if (db.prepare(`SELECT 1 FROM ${table} WHERE ${scope}(typeof(${clock}) <> 'integer' OR ${clock} < 1000000000000) LIMIT 1`).get()) {
        entries.push({ name: plan.name, deleted: 0, status: 'error', unit, error: 'timestamp_format' });
        continue;
      }
      const result = db.prepare(plan.sql).run(plan.cutoff);
      entries.push({ name: plan.name, deleted: result.changes, status: 'ok', unit });
    } catch {
      // Continuer les catégories indépendantes, mais rendre le passage incomplet et visible.
      entries.push({ name: plan.name, deleted: 0, status: 'error', unit, error: 'database_error' });
    }
  }
  return { ok: entries.every(e => e.status !== 'error'), entries, totalDeleted: entries.reduce((n, e) => n + e.deleted, 0) };
}

/** Nettoyage planifié complet, avec témoin minimal ; les erreurs ne deviennent jamais un succès HTTP. */
export function runFullCleanup(db: Database.Database, now = Date.now()): Promise<CleanupProof> {
  const active = running.get(db);
  if (active) return active;
  const work = performFullCleanup(db, now).finally(() => running.delete(db));
  running.set(db, work);
  return work;
}

async function performFullCleanup(db: Database.Database, now: number): Promise<CleanupProof> {
  const result = runCleanup(db, now);
  for (const compartment of ['dashboard', 'financial'] as const) {
    const name = `bronze_${compartment}` as const;
    try {
      const root = bronzePath(compartment, db.name);
      const { deleted, failed, absent } = await purgeExpiredBronze(root, now);
      invalidateBronzeUsage(root);
      if (failed) result.ok = false;
      result.entries.push({ name, deleted, status: failed ? 'error' : absent ? 'not_applicable' : 'ok', unit: 'folders', ...(failed ? { error: 'storage_error' as const } : {}) });
      result.totalDeleted += deleted;
    } catch {
      result.ok = false;
      result.entries.push({ name, deleted: 0, status: 'error', unit: 'folders', error: 'storage_error' });
    }
  }
  const proof: CleanupProof = { ...result, checked_at: now };
  try {
    db.prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('cleanup',?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json")
      .run(now, JSON.stringify(proof));
  } catch {
    proof.ok = false;
    proof.entries.push({ name: 'cleanup_proof', deleted: 0, status: 'error', unit: 'rows', error: 'proof_error' });
  }
  return proof;
}

const proofSchema = z.object({
  ok: z.boolean(), checked_at: z.number().int().nonnegative().max(8_640_000_000_000_000), totalDeleted: z.number().int().nonnegative().safe(),
  entries: z.array(z.object({
    name: z.enum(CLEANUP_CATEGORIES), deleted: z.number().int().nonnegative().safe(),
    status: z.enum(['ok', 'not_applicable', 'error']), unit: z.enum(['rows', 'references', 'folders']),
    error: z.enum(['database_error', 'storage_error', 'proof_error', 'timestamp_format']).optional(),
  })).min(10).max(12),
});

/** N’expose que le témoin connu et cohérent ; un ancien/mauvais JSON n’est pas une preuve de réussite. */
export function readCleanupProof(db: Database.Database): CleanupProof | null {
  try {
    const row = db.prepare("SELECT checked_at,details_json FROM operation_checks WHERE name='cleanup'").get() as { checked_at: number; details_json: string } | undefined;
    if (!row) return null;
    const parsed = proofSchema.safeParse(JSON.parse(row.details_json));
    if (!parsed.success) return null;
    const result = parsed.data, names = new Set(result.entries.map(e => e.name));
    if (result.checked_at !== row.checked_at || names.size !== result.entries.length ||
      CLEANUP_CATEGORIES.slice(0, 10).some(name => !names.has(name)) ||
      result.totalDeleted !== result.entries.reduce((sum, e) => sum + e.deleted, 0) ||
      result.ok !== result.entries.every(e => e.status !== 'error')) return null;
    return result;
  } catch { return null; }
}
