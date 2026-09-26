// Bronze chiffré → expiration des seules copies techniques datées ; aucun contenu n’est lu ni réécrit.
import { lstat, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Même frontière UTC que la purge historique déclenchée à la consultation. */
export async function purgeExpiredBronze(root: string, now = Date.now()): Promise<{ deleted: number; failed: number; absent?: boolean }> {
  let info;
  try {
    const parent = await lstat(dirname(root));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('bronze_parent_not_directory');
    info = await lstat(root);
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { deleted: 0, failed: 0, absent: true }; throw error; }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('bronze_root_not_directory');
  const cutoff = new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);
  let deleted = 0, failed = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const date = Date.parse(entry.name);
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== entry.name || entry.name >= cutoff) continue;
    // rm ne suit pas les liens symboliques contenus dans ce dossier technique.
    try {
      await rm(join(root, entry.name), { recursive: true });
      deleted++;
    } catch (error) {
      // Une autre purge peut avoir retiré le dossier entre l’inventaire et cette suppression.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed++;
    }
  }
  return { deleted, failed };
}
