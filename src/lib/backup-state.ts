import type Database from 'better-sqlite3';
import { z } from 'zod';
import { backupInspectionSchema } from './backup-verification.js';
import type { BackupInspection } from './backup-inspection.js';
import { BACKUP_CHECK_ERRORS } from './backup-inspection.js';

export const BACKUP_PHASES = ['snapshot', 'upload', 'restore', 'manifest', 'retention', 'proof', 'complete'] as const;
export const BACKUP_ERRORS = [...BACKUP_CHECK_ERRORS, ...BACKUP_PHASES.map(phase => `backup_failed_${phase}`)] as [string, ...string[]];

export type BackupCheck = {
  name: 'backup' | 'backup_attempt'; checked_at: number;
  encrypted?: boolean; restore_check?: string; size_bytes?: number; restore_verification?: BackupInspection;
  state?: 'running' | 'success' | 'failed';
  phase?: typeof BACKUP_PHASES[number]; error?: string; r2_key?: string; manifest_key?: string; retention_status?: 'ok' | 'error';
};
export function writeBackupAttempt(db: Database.Database, state: 'running' | 'success' | 'failed', phase: string, error?: string): void {
  db.prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('backup_attempt',?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json")
    .run(Date.now(), JSON.stringify({ state, phase, ...(error ? { error } : {}) }));
}
const metadata = z.object({
  encrypted: z.boolean().optional(), restore_check: z.enum(['ok']).optional(), size_bytes: z.number().int().nonnegative().safe().optional(),
  restore_verification: backupInspectionSchema.optional(), state: z.enum(['running', 'success', 'failed']).optional(),
  phase: z.enum(BACKUP_PHASES).optional(), error: z.enum(BACKUP_ERRORS).optional(), retention_status: z.enum(['ok', 'error']).optional(),
  r2_key: z.string().regex(/^backups\/db-\d{4}-\d{2}-\d{2}-\d+\.sqlite(?:\.gz)?\.enc$/).optional(),
  manifest_key: z.string().regex(/^backups\/verified\/db-\d{4}-\d{2}-\d{2}-\d+\.sqlite(?:\.gz)?\.enc\.json$/).optional(),
});
export function readBackupChecks(db: Database.Database): BackupCheck[] {
  try {
    const rows = db.prepare("SELECT name,checked_at,details_json FROM operation_checks WHERE name IN ('backup','backup_attempt')").all() as Array<{ name: BackupCheck['name']; checked_at: number; details_json: string }>;
    return rows.map(row => {
        const data = metadata.parse(JSON.parse(row.details_json));
        if (!Number.isSafeInteger(row.checked_at) || row.checked_at < 0 || row.checked_at > 8_640_000_000_000_000 || (row.name === 'backup_attempt' && !data.state)) throw new Error('backup_metadata_invalid');
        return { name: row.name, checked_at: row.checked_at, ...data };
    });
  } catch { return []; }
}
