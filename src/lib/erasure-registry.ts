// Registre des effacements → copie hors du fichier SQLite → réapplication des entrées que la base restaurée ignore.
// Une restauration remplace la base et son registre interne ; la copie voisine garde les effacements postérieurs.
// Contenu : catégorie, identifiant interne et date. Jamais d'adresse, d'empreinte d'adresse ni de contenu.
// Jamais bloquant : une erreur n'empêche pas l'ouverture du service ; elle rend le témoin rouge dans le bureau.
import type Database from 'better-sqlite3';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { erasureRegistryPath } from './data-paths.js';
import { ERASURE_CATEGORIES, eraseCrmRecords, eraseCustomerAccount, eraseOrder, RetentionError, type EraseOutcome, type ErasureCategory } from './retention-rules.js';

export type ErasureEntry = { category: ErasureCategory; subject_id: number; erased_at: number };
export const REPLAY_ISSUES = ['registry_path_invalid', 'mirror_unreadable', 'mirror_write_failed', 'replay_pending', 'database_error'] as const;
export type ReplayIssue = typeof REPLAY_ISSUES[number];
const DEFER_REASONS = ['account_has_records', 'timestamp_format', 'database_error'] as const;
export type ReplayResult = {
  status: 'ok' | 'suspended' | 'error'; origin: 'startup' | 'cleanup'; checked_at: number; issues: ReplayIssue[];
  mirror_entries: number; pending: number; future: number; reapplied: Record<ErasureCategory, number>;
  deferred: number; deferred_entries: Array<{ category: ErasureCategory; subject_id: number; reason: typeof DEFER_REASONS[number] }>;
  mirror: 'created' | 'updated' | 'unchanged' | 'failed' | 'skipped';
};
/** Code fermé ; seuls la catégorie et l'identifiant interne d'une entrée peuvent l'accompagner. */
export class ErasureRegistryError extends Error {
  constructor(readonly code: 'registry_path_invalid' | 'mirror_unreadable') { super(code); }
}

const entrySchema = z.object({
  category: z.enum(ERASURE_CATEGORIES), subject_id: z.number().int().positive().safe(), erased_at: z.number().int().min(1_000_000_000_000).safe(),
}).strict();
const mirrorSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) }).strict();
const rank = (category: ErasureCategory) => ERASURE_CATEGORIES.indexOf(category);
const keyOf = (entry: ErasureEntry) => `${entry.category}:${entry.subject_id}:${entry.erased_at}`;
// Ordre chronologique ; à date égale, l'ordre du nettoyage (achats, suivi, compte).
const chronological = (a: ErasureEntry, b: ErasureEntry) => a.erased_at - b.erased_at || rank(a.category) - rank(b.category) || a.subject_id - b.subject_id;
const DEFERRED_KEPT = 20;

/**
 * Dossier retention/ : répertoire réel, jamais un lien symbolique ; créé privé s'il manque. Comme pour le bronze,
 * seul ce niveau est contrôlé : le dossier de la base lui-même n'est pas examiné.
 */
function mirrorPath(db: Database.Database): string {
  let path: string;
  try { path = erasureRegistryPath(db.name); } catch { throw new ErasureRegistryError('registry_path_invalid'); }
  const folder = dirname(path);
  try {
    const info = lstatSync(folder, { throwIfNoEntry: false });
    if (!info) mkdirSync(folder, { mode: 0o700 });
    else if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('folder');
  } catch { throw new ErasureRegistryError('registry_path_invalid'); }
  return path;
}

/** Copie existante validée ; null si absente. Une copie illisible ou vide n'est jamais ignorée ni réécrite. */
export function readErasureMirror(path: string): ErasureEntry[] | null {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  try {
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('not_a_file');
    return mirrorSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).entries;
  } catch { throw new ErasureRegistryError('mirror_unreadable'); }
}

/** Écriture complète dans un fichier temporaire synchronisé, puis renommage : jamais de copie à moitié écrite. */
function writeErasureMirror(path: string, entries: ErasureEntry[]): void {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeSync(fd, JSON.stringify({ version: 1, entries }) + '\n');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try { renameSync(temporary, path); }
  catch (error) { rmSync(temporary, { force: true }); throw error; }
  // Synchronisation du dossier au mieux : certains montages la refusent sans que le renommage soit en cause.
  let folder: number | undefined;
  try {
    folder = openSync(dirname(path), 'r');
    fsyncSync(folder);
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(String((error as NodeJS.ErrnoException).code))) throw error;
  } finally { if (folder !== undefined) closeSync(folder); }
}

function tableEntries(db: Database.Database): ErasureEntry[] {
  return (db.prepare('SELECT category,subject_id,erased_at FROM retention_erasures').all() as ErasureEntry[]).sort(chronological);
}

/** Même fonction d'effacement que la règle, bornée par la date ; un compte bloqué perd d'abord son suivi résiduel. */
function reapply(db: Database.Database, entry: ErasureEntry): EraseOutcome {
  if (entry.category === 'purchase_order') return eraseOrder(db, entry.subject_id, entry.erased_at);
  if (entry.category === 'crm_records') return eraseCrmRecords(db, entry.subject_id, entry.erased_at);
  try { return eraseCustomerAccount(db, entry.subject_id, entry.erased_at); }
  catch (error) {
    if (!(error instanceof RetentionError) || error.code !== 'account_has_records') throw error;
    // Suivi retiré hors registre après la sauvegarde (langue effacée à la main, par exemple) : même borne.
    eraseCrmRecords(db, entry.subject_id, entry.erased_at);
    return eraseCustomerAccount(db, entry.subject_id, entry.erased_at);
  }
}

/**
 * Au démarrage réel (avant serve() et les files) et à chaque nettoyage : réapplique seulement les entrées de la copie
 * absentes de la table (base restaurée), dans l'ordre chronologique et bornées par leur date. Une entrée postérieure à
 * maintenant est ignorée et signalée ; une entrée impossible est reportée. Aucune exception ne sort de cette fonction :
 * le résultat, gardé dans operation_checks/erasure_replay, dit ce qui reste à examiner.
 */
export function reapplyErasures(db: Database.Database, now: number, origin: ReplayResult['origin']): ReplayResult {
  const result: ReplayResult = {
    status: 'ok', origin, checked_at: now, issues: [], mirror_entries: 0, pending: 0, future: 0,
    reapplied: { purchase_order: 0, crm_records: 0, customer_account: 0 }, deferred: 0, deferred_entries: [], mirror: 'skipped',
  };
  // Interrupteur d'intervention (annulation d'un effacement erroné) : ni réapplication ni réécriture de la copie.
  if (process.env.OSD_SKIP_ERASURE_REPLAY === '1') return keep(db, { ...result, status: 'suspended' });
  let path: string, mirror: ErasureEntry[] | null;
  try { path = mirrorPath(db); mirror = readErasureMirror(path); }
  catch (error) { return keep(db, { ...result, status: 'error', issues: [error instanceof ErasureRegistryError ? error.code : 'mirror_unreadable'] }); }
  try {
    const known = new Set(tableEntries(db).map(keyOf));
    const pending = (mirror ?? []).filter(entry => !known.has(keyOf(entry))).sort(chronological);
    const due = pending.filter(entry => entry.erased_at <= now);
    Object.assign(result, { mirror_entries: mirror?.length ?? 0, pending: pending.length, future: pending.length - due.length });
    if (due.length) {
      // Les compteurs ne sont retenus qu'après la validation de l'ensemble.
      const outcome = db.transaction(() => {
        const insert = db.prepare('INSERT OR IGNORE INTO retention_erasures(category,subject_id,erased_at) VALUES(?,?,?)');
        const reapplied = { ...result.reapplied }, deferred: ReplayResult['deferred_entries'] = [];
        let deferredCount = 0;
        for (const entry of due) {
          try {
            // Point de reprise par entrée : un échec annule seulement cette entrée, qui reste dans la copie pour plus tard.
            const erased = db.transaction(() => {
              const done = reapply(db, entry) === 'erased';
              insert.run(entry.category, entry.subject_id, entry.erased_at);
              return done;
            })();
            if (erased) reapplied[entry.category]++;
          } catch (error) {
            deferredCount++;
            const reason = error instanceof RetentionError ? error.code : 'database_error';
            if (deferred.length < DEFERRED_KEPT) deferred.push({ category: entry.category, subject_id: entry.subject_id, reason });
          }
        }
        return { reapplied, deferred, deferredCount };
      }).immediate();
      Object.assign(result, { reapplied: outcome.reapplied, deferred: outcome.deferredCount, deferred_entries: outcome.deferred });
    }
  } catch { result.issues.push('database_error'); }
  if (result.deferred || result.future) result.issues.push('replay_pending');
  try {
    const merged = new Map((mirror ?? []).map(entry => [keyOf(entry), entry]));
    for (const entry of tableEntries(db)) merged.set(keyOf(entry), entry);
    if (mirror && merged.size === mirror.length) result.mirror = 'unchanged';
    else {
      writeErasureMirror(path, [...merged.values()].sort(chronological));
      result.mirror = mirror ? 'updated' : 'created';
    }
  } catch {
    result.mirror = 'failed';
    result.issues.push('mirror_write_failed');
  }
  return keep(db, { ...result, status: result.issues.length ? 'error' : 'ok' });
}

function keep(db: Database.Database, result: ReplayResult): ReplayResult {
  try {
    db.prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('erasure_replay',?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json")
      .run(result.checked_at, JSON.stringify(result));
  } catch { console.error('[conservation] témoin du registre des effacements non enregistré'); }
  return result;
}

const witnessSchema = z.object({
  status: z.enum(['ok', 'suspended', 'error']), origin: z.enum(['startup', 'cleanup']), checked_at: z.number().int().nonnegative().safe(),
  issues: z.array(z.enum(REPLAY_ISSUES)), mirror_entries: z.number().int().nonnegative(), pending: z.number().int().nonnegative(),
  future: z.number().int().nonnegative(), reapplied: z.object({ purchase_order: z.number().int().nonnegative(), crm_records: z.number().int().nonnegative(), customer_account: z.number().int().nonnegative() }).strict(),
  deferred: z.number().int().nonnegative(),
  deferred_entries: z.array(z.object({ category: z.enum(ERASURE_CATEGORIES), subject_id: z.number().int().positive(), reason: z.enum(DEFER_REASONS) }).strict()).max(DEFERRED_KEPT),
  mirror: z.enum(['created', 'updated', 'unchanged', 'failed', 'skipped']),
}).strict();
/** Dernier témoin cohérent pour le bureau ; un JSON inconnu ou altéré n'est pas présenté. */
export function readErasureReplay(db: Database.Database): ReplayResult | null {
  try {
    const row = db.prepare("SELECT checked_at,details_json FROM operation_checks WHERE name='erasure_replay'").get() as { checked_at: number; details_json: string } | undefined;
    if (!row) return null;
    const parsed = witnessSchema.safeParse(JSON.parse(row.details_json));
    return parsed.success && parsed.data.checked_at === row.checked_at ? parsed.data : null;
  } catch { return null; }
}
