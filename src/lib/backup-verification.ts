import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BACKUP_CHECK_ERRORS, BackupInspectionError, type BackupInspection } from './backup-inspection.js';

export const backupInspectionSchema = z.object({
  version: z.literal(1), byte_match: z.literal(true), integrity: z.literal('ok'), foreign_keys: z.literal('ok'),
  required_schema: z.literal('ok'), current_versions: z.literal('ok'), duration_ms: z.number().int().nonnegative().safe(),
});

/** Isole le contrôle SQLite coûteux et borne sa durée sans bloquer les requêtes du serveur. */
export function verifyRestoredBackup(snapshotPath: string, restoredPath: string, timeoutMs = 60_000): Promise<BackupInspection> {
  const source = import.meta.url.endsWith('.ts');
  const worker = fileURLToPath(new URL(source ? './backup-inspection.ts' : './backup-inspection.js', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...(source ? ['--import', 'tsx'] : []), worker, snapshotPath, restoredPath], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      // Aucun identifiant de production n’est transmis au processus de lecture des deux fichiers temporaires.
      env: { NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '', timedOut = false, tooLarge = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    timer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 8192) { tooLarge = true; output = ''; child.kill('SIGKILL'); }
    });
    child.once('error', () => { clearTimeout(timer); reject(new BackupInspectionError('backup_inspection_failed')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new BackupInspectionError('backup_inspection_timeout'));
      if (tooLarge) return reject(new BackupInspectionError('backup_inspection_failed'));
      try {
        const data = JSON.parse(output);
        if (code !== 0) throw new BackupInspectionError(BACKUP_CHECK_ERRORS.includes(data.error) ? data.error : 'backup_inspection_failed');
        resolve(backupInspectionSchema.parse(data));
      } catch (error) { reject(error instanceof BackupInspectionError ? error : new BackupInspectionError('backup_inspection_failed')); }
    });
  });
}
