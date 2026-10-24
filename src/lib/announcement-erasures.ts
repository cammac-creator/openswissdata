// Registre des effacements des inscriptions « être prévenu », sur le modèle de erasure-registry.ts, sans toucher
// retention_erasures ni retention-rules.ts (F2). Chaque effacement (désinscription, purge, demande neuve dont le mail
// n'est pas parti) est inscrit dans la table announcement_erasures, dans la transaction même de l'effacement, puis dans
// une copie voisine hors du fichier SQLite : retention/announcement-erasures.json. Une restauration remplace la base
// et sa table ; la copie garde les effacements postérieurs, réappliqués au démarrage et à chaque nettoyage.
// Contenu : identifiant interne et date de l'effacement, rien d'autre. Jamais d'adresse, d'empreinte ni de jeton.
// Jamais bloquant : une erreur n'empêche pas l'ouverture du service ; elle rend la catégorie rouge dans le témoin.
import type Database from 'better-sqlite3';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { erasureRegistryPath } from './data-paths.js';
import { readBackupChecks } from './backup-state.js';

export type AnnouncementErasure = { subject_id: number; erased_at: number };
export const ANNOUNCEMENT_REPLAY_ISSUES = ['registry_path_invalid', 'mirror_unreadable', 'mirror_write_failed', 'replay_pending', 'database_error'] as const;
export type AnnouncementReplayIssue = typeof ANNOUNCEMENT_REPLAY_ISSUES[number];
export type AnnouncementReplayResult = {
  status: 'ok' | 'suspended' | 'error'; origin: 'startup' | 'cleanup'; checked_at: number; issues: AnnouncementReplayIssue[];
  mirror_entries: number; due: number; future: number; reapplied: number; retired: number;
  mirror: 'created' | 'updated' | 'unchanged' | 'failed' | 'skipped';
};
export class AnnouncementRegistryError extends Error {
  constructor(readonly code: 'registry_path_invalid' | 'mirror_unreadable') { super(code); }
}

const DAY = 86_400_000;
/**
 * Retrait d'une entrée devenue inutile, pour que la copie ne grandisse pas sans fin. Une ligne effacée ne peut revenir
 * que par une sauvegarde prise AVANT son effacement. Les sauvegardes R2 sont élaguées après 30 jours
 * (`backup-to-r2`, src/routes/admin.ts), mais seulement lors d'une sauvegarde réussie : si les sauvegardes s'arrêtent,
 * les anciennes restent. D'où deux conditions cumulées :
 * - au moins 180 jours depuis l'effacement (plancher fixe, six cycles de sauvegarde) ;
 * - le dernier témoin de sauvegarde validée a un élagage réussi (`retention_status: ok`) à une date S telle que
 *   S − 30 jours − 7 jours de marge (durée d'un envoi, décalage d'horloge avec R2) est postérieur à l'effacement :
 *   toute copie prise avant l'effacement a alors été supprimée.
 * Sans témoin de sauvegarde, rien n'est retiré. Après une restauration, le témoin restauré est plus ancien : on retire
 * moins, jamais plus. Les copies gardées hors de R2 (aucune n'est prévue par docs/sauvegarde-et-reprise.md) ne sont pas
 * couvertes.
 */
export const ERASURE_KEEP_MIN_MS = 180 * DAY;
export const BACKUP_RETENTION_MS = 30 * DAY;
export const BACKUP_MARGIN_MS = 7 * DAY;

const entrySchema = z.object({ subject_id: z.number().int().positive().safe(), erased_at: z.number().int().min(1_000_000_000_000).safe() }).strict();
const mirrorSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) }).strict();
const keyOf = (entry: AnnouncementErasure) => `${entry.subject_id}:${entry.erased_at}`;
const chronological = (a: AnnouncementErasure, b: AnnouncementErasure) => a.erased_at - b.erased_at || a.subject_id - b.subject_id;

/** Même dossier que la copie du registre existant ; répertoire réel, jamais un lien symbolique, créé privé s'il manque. */
function mirrorPath(db: Database.Database): string {
  let path: string;
  try { path = join(dirname(erasureRegistryPath(db.name)), 'announcement-erasures.json'); } catch { throw new AnnouncementRegistryError('registry_path_invalid'); }
  const folder = dirname(path);
  try {
    const info = lstatSync(folder, { throwIfNoEntry: false });
    if (!info) mkdirSync(folder, { mode: 0o700 });
    else if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('folder');
  } catch { throw new AnnouncementRegistryError('registry_path_invalid'); }
  return path;
}

/** Copie existante validée ; null si absente. Une copie illisible, vide ou remplacée par un lien n'est jamais réécrite. */
export function readAnnouncementErasureMirror(path: string): AnnouncementErasure[] | null {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  try {
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('not_a_file');
    return mirrorSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).entries;
  } catch { throw new AnnouncementRegistryError('mirror_unreadable'); }
}

/** Fichier temporaire privé (0600) synchronisé, puis renommage : jamais de copie à moitié écrite. */
function writeMirror(path: string, entries: AnnouncementErasure[]): void {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeSync(fd, JSON.stringify({ version: 1, entries }) + '\n');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try { renameSync(temporary, path); }
  catch (error) { rmSync(temporary, { force: true }); throw error; }
  let folder: number | undefined;
  try {
    folder = openSync(dirname(path), 'r');
    fsyncSync(folder);
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(String((error as NodeJS.ErrnoException).code))) throw error;
  } finally { if (folder !== undefined) closeSync(folder); }
}

/** À appeler DANS la transaction de l'effacement : l'entrée et l'effacement sont validés ensemble. */
export function recordAnnouncementErasures(db: Database.Database, subjectIds: readonly number[], erasedAt: number): void {
  const insert = db.prepare('INSERT OR IGNORE INTO announcement_erasures(subject_id,erased_at) VALUES(?,?)');
  for (const id of subjectIds) insert.run(id, erasedAt);
}

function tableEntries(db: Database.Database): AnnouncementErasure[] {
  return (db.prepare('SELECT subject_id,erased_at FROM announcement_erasures').all() as AnnouncementErasure[]).sort(chronological);
}

/** Copie = copie existante ∪ table, moins les entrées retirées ; écrite seulement si elle change. */
function syncMirror(path: string, mirror: AnnouncementErasure[] | null, table: AnnouncementErasure[], retiredBefore: number | null): AnnouncementReplayResult['mirror'] {
  const merged = new Map((mirror ?? []).map(entry => [keyOf(entry), entry]));
  for (const entry of table) merged.set(keyOf(entry), entry);
  const kept = [...merged.values()].filter(entry => retiredBefore === null || entry.erased_at >= retiredBefore).sort(chronological);
  const before = new Set((mirror ?? []).map(keyOf));
  if (mirror && kept.length === before.size && kept.every(entry => before.has(keyOf(entry)))) return 'unchanged';
  writeMirror(path, kept);
  return mirror ? 'updated' : 'created';
}

/**
 * Après une désinscription ou un mail manqué : recopie aussitôt la table dans la copie. Lève une erreur sans détail si la
 * copie est illisible (elle n'est alors pas réécrite) ou impossible à écrire ; l'entrée reste en table et le nettoyage
 * suivant réessaie. L'appelant n'en fait jamais un échec de la désinscription.
 */
export function syncAnnouncementErasureMirror(db: Database.Database): void {
  if (process.env.OSD_SKIP_ERASURE_REPLAY === '1') return;
  const path = mirrorPath(db);
  syncMirror(path, readAnnouncementErasureMirror(path), tableEntries(db), null);
}

/** Instant avant lequel une entrée peut être retirée, ou null (aucune preuve d'élagage). */
export function announcementErasureRetirementCutoff(db: Database.Database, now: number): number | null {
  const backup = readBackupChecks(db).find(check => check.name === 'backup');
  if (!backup || backup.retention_status !== 'ok') return null;
  return Math.min(now - ERASURE_KEEP_MIN_MS, backup.checked_at - BACKUP_RETENTION_MS - BACKUP_MARGIN_MS);
}

/**
 * Au démarrage réel (avant serve() et les files) et à chaque nettoyage complet : pour chaque entrée de la copie et de la
 * table dont la date est passée, efface la ligne de même identifiant DEMANDÉE AU PLUS TARD À CETTE DATE. Après une
 * restauration, sqlite_sequence peut redonner un ancien identifiant à une nouvelle demande : demandée après
 * l'effacement, elle n'est jamais touchée. Une entrée datée dans le futur est ignorée et signalée. Aucune exception ne
 * sort de cette fonction ; le résultat est gardé dans operation_checks/announcement_erasure_replay.
 */
export function reapplyAnnouncementErasures(db: Database.Database, now: number, origin: AnnouncementReplayResult['origin']): AnnouncementReplayResult {
  const result: AnnouncementReplayResult = { status: 'ok', origin, checked_at: now, issues: [], mirror_entries: 0, due: 0, future: 0, reapplied: 0, retired: 0, mirror: 'skipped' };
  // Même interrupteur d'intervention que le registre existant : ni réapplication ni réécriture de la copie.
  if (process.env.OSD_SKIP_ERASURE_REPLAY === '1') return keep(db, { ...result, status: 'suspended' });
  let path: string, mirror: AnnouncementErasure[] | null;
  try { path = mirrorPath(db); mirror = readAnnouncementErasureMirror(path); }
  catch (error) { return keep(db, { ...result, status: 'error', issues: [error instanceof AnnouncementRegistryError ? error.code : 'mirror_unreadable'] }); }
  let table: AnnouncementErasure[] = [];
  try {
    const all = new Map((mirror ?? []).map(entry => [keyOf(entry), entry]));
    for (const entry of tableEntries(db)) all.set(keyOf(entry), entry);
    const entries = [...all.values()].sort(chronological), due = entries.filter(entry => entry.erased_at <= now);
    Object.assign(result, { mirror_entries: mirror?.length ?? 0, due: due.length, future: entries.length - due.length });
    result.reapplied = db.transaction(() => {
      const erase = db.prepare('DELETE FROM announcement_subscriptions WHERE id=? AND requested_at<=?');
      const insert = db.prepare('INSERT OR IGNORE INTO announcement_erasures(subject_id,erased_at) VALUES(?,?)');
      let erased = 0;
      for (const entry of due) {
        erased += erase.run(entry.subject_id, entry.erased_at).changes;
        insert.run(entry.subject_id, entry.erased_at);
      }
      return erased;
    }).immediate();
    table = tableEntries(db);
  } catch { result.issues.push('database_error'); }
  if (result.future) result.issues.push('replay_pending');
  // Retrait seulement après un passage net (rien en attente, aucune erreur) et avec une preuve d'élagage des sauvegardes.
  let retiredBefore: number | null = null;
  if (!result.issues.length) {
    try {
      retiredBefore = announcementErasureRetirementCutoff(db, now);
      if (retiredBefore !== null) {
        const cutoff = retiredBefore;
        const before = new Set([...(mirror ?? []), ...table].filter(entry => entry.erased_at < cutoff).map(keyOf));
        db.prepare('DELETE FROM announcement_erasures WHERE erased_at<?').run(cutoff);
        table = tableEntries(db);
        result.retired = before.size;
      }
    } catch { retiredBefore = null; result.issues.push('database_error'); }
  }
  try {
    result.mirror = syncMirror(path, mirror, table, retiredBefore);
  } catch {
    result.mirror = 'failed';
    result.issues.push('mirror_write_failed');
  }
  return keep(db, { ...result, status: result.issues.length ? 'error' : 'ok' });
}

function keep(db: Database.Database, result: AnnouncementReplayResult): AnnouncementReplayResult {
  try {
    db.prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('announcement_erasure_replay',?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json")
      .run(result.checked_at, JSON.stringify(result));
  } catch { console.error('[annonce] témoin du registre des effacements non enregistré'); }
  return result;
}

/** Code d'erreur de la catégorie `announcement_subscriptions` du témoin de nettoyage, ou null si tout va bien. */
export function announcementReplayError(result: AnnouncementReplayResult): 'registry_suspended' | 'database_error' | 'storage_error' | 'replay_pending' | null {
  if (result.status === 'suspended') return 'registry_suspended';
  if (result.status === 'ok') return null;
  if (result.issues.includes('database_error')) return 'database_error';
  if (result.issues.some(issue => issue !== 'replay_pending')) return 'storage_error';
  return 'replay_pending';
}
