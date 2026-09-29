// Registre des effacements → copie hors du fichier SQLite → rejeu au démarrage réel, avant l'ouverture du service.
// Une restauration remplace la base et son registre interne ; la copie voisine garde les effacements postérieurs.
// Contenu : catégorie, identifiant interne et date. Jamais d'adresse, d'empreinte d'adresse ni de contenu.
import type Database from 'better-sqlite3';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { erasureRegistryPath } from './data-paths.js';
import { ERASURE_CATEGORIES, eraseCrmRecords, eraseCustomerAccount, eraseOrder, type EraseOutcome, type ErasureCategory } from './retention-rules.js';

export type ErasureEntry = { category: ErasureCategory; subject_id: number; erased_at: number };
export type ReplayResult = {
  entries: number; merged: number; newer: number;
  reapplied: Record<ErasureCategory, number>; mirror: 'created' | 'updated' | 'unchanged';
};
/** Seuls la catégorie et l'identifiant interne d'une entrée en échec sont exposés au journal. */
export class ErasureRegistryError extends Error {
  constructor(readonly code: 'registry_path_invalid' | 'mirror_unreadable' | 'replay_failed', readonly entry?: { category: ErasureCategory; subject_id: number }) { super(code); }
}

const entrySchema = z.object({
  category: z.enum(ERASURE_CATEGORIES), subject_id: z.number().int().positive().safe(), erased_at: z.number().int().min(1_000_000_000_000).safe(),
}).strict();
const mirrorSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) }).strict();
const rank = (category: ErasureCategory) => ERASURE_CATEGORIES.indexOf(category);
const keyOf = (entry: ErasureEntry) => `${entry.category}:${entry.subject_id}:${entry.erased_at}`;
// Ordre chronologique ; à date égale, l'ordre du nettoyage (achats, suivi, compte).
const chronological = (a: ErasureEntry, b: ErasureEntry) => a.erased_at - b.erased_at || rank(a.category) - rank(b.category) || a.subject_id - b.subject_id;
const erasers: Record<ErasureCategory, (db: Database.Database, id: number, bound: number) => EraseOutcome> = {
  purchase_order: eraseOrder, crm_records: eraseCrmRecords, customer_account: eraseCustomerAccount,
};

/** Dossier de la copie : répertoire réel, jamais un lien symbolique ; créé privé s'il manque. */
function mirrorPath(db: Database.Database): string {
  let path: string;
  try { path = erasureRegistryPath(db.name); } catch { throw new ErasureRegistryError('registry_path_invalid'); }
  const folder = dirname(path);
  try {
    const parent = lstatSync(dirname(folder));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('parent');
    const info = lstatSync(folder, { throwIfNoEntry: false });
    if (!info) mkdirSync(folder, { mode: 0o700 });
    else if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('folder');
  } catch { throw new ErasureRegistryError('registry_path_invalid'); }
  return path;
}

/** Copie existante validée ; null si absente. Une copie illisible n'est jamais ignorée en silence. */
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
  const folder = openSync(dirname(path), 'r');
  try { fsyncSync(folder); } finally { closeSync(folder); }
}

function tableEntries(db: Database.Database): ErasureEntry[] {
  return (db.prepare('SELECT category,subject_id,erased_at FROM retention_erasures').all() as ErasureEntry[]).sort(chronological);
}

/** Copie = union de la copie existante et du registre de la base ; réécrite seulement si elle change. */
export function syncErasureMirror(db: Database.Database): 'created' | 'updated' | 'unchanged' {
  const path = mirrorPath(db), existing = readErasureMirror(path);
  const merged = new Map((existing ?? []).map(entry => [keyOf(entry), entry]));
  for (const entry of tableEntries(db)) merged.set(keyOf(entry), entry);
  if (existing && merged.size === existing.length) return 'unchanged';
  writeErasureMirror(path, [...merged.values()].sort(chronological));
  return existing ? 'updated' : 'created';
}

/**
 * Au démarrage réel, avant serve() et les files : fusionne la copie dans la base, puis réapplique chaque effacement
 * dont le sujet réapparaît (base restaurée), borné par sa date. Une ligne plus récente, ou un identifiant réattribué
 * après la restauration, reste intact. Tout échec annule le rejeu entier et doit empêcher l'ouverture du service.
 */
export function replayErasureRegistry(db: Database.Database, now = Date.now()): ReplayResult {
  const mirror = readErasureMirror(mirrorPath(db));
  const outcome = db.transaction(() => {
    const insert = db.prepare('INSERT OR IGNORE INTO retention_erasures(category,subject_id,erased_at) VALUES(?,?,?)');
    let merged = 0, newer = 0;
    for (const entry of mirror ?? []) merged += insert.run(entry.category, entry.subject_id, entry.erased_at).changes;
    const entries = tableEntries(db), reapplied: Record<ErasureCategory, number> = { purchase_order: 0, crm_records: 0, customer_account: 0 };
    for (const entry of entries) {
      let result: EraseOutcome;
      try { result = erasers[entry.category](db, entry.subject_id, entry.erased_at); }
      catch { throw new ErasureRegistryError('replay_failed', { category: entry.category, subject_id: entry.subject_id }); }
      if (result === 'erased') reapplied[entry.category]++;
      else if (result === 'newer') newer++;
    }
    return { entries: entries.length, merged, newer, reapplied };
  }).immediate();
  const result: ReplayResult = { ...outcome, mirror: syncErasureMirror(db) };
  db.prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('erasure_replay',?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json")
    .run(now, JSON.stringify({ ...result, checked_at: now }));
  return result;
}
