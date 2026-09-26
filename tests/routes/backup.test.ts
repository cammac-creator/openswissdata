import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cloud = vi.hoisted(() => ({ bytes: Buffer.alloc(0), objects: new Map<string, Buffer>(), send: vi.fn(), read: vi.fn(), destroy: vi.fn() }));
vi.mock('@aws-sdk/client-s3', async original => ({
  ...await original<typeof import('@aws-sdk/client-s3')>(),
  S3Client: class { send = cloud.send; destroy = cloud.destroy; },
}));
vi.mock('../../src/lib/r2.js', async original => ({ ...await original<typeof import('../../src/lib/r2.js')>(), getObjectBuffer: cloud.read }));
import { getDb, closeDb } from '../../src/lib/db.js';
import { createApp } from '../../src/index.js';
import { readBackupChecks } from '../../src/lib/backup-state.js';

describe('Sauvegarde chiffrée et restauration de bout en bout sur données fictives', () => {
  let dir: string;
  const headers = { 'x-admin-secret': 'secret-uniquement-fictif' };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'osd-backup-route-fictif-'));
    for (const [key, value] of Object.entries({ DATABASE_PATH: join(dir, 'fictive.sqlite'), ADMIN_SECRET: headers['x-admin-secret'], R2_ACCOUNT_ID: 'compte-fictif', R2_ACCESS_KEY_ID: 'cle-fictive', R2_SECRET_ACCESS_KEY: 'secret-fictif', R2_BUCKET: 'bucket-fictif', OSD_BACKUP_KEY: 'b'.repeat(64) })) vi.stubEnv(key, value);
    getDb().prepare("INSERT INTO customers(email,created_at) VALUES('personne@example.test',?)").run(Date.now());
    cloud.bytes = Buffer.alloc(0); cloud.objects.clear(); cloud.destroy.mockReset();
    cloud.send.mockReset().mockImplementation(async command => {
      if (command.constructor.name === 'PutObjectCommand') {
        const bytes = Buffer.from(command.input.Body); cloud.objects.set(command.input.Key, bytes);
        if (!command.input.Key.includes('/verified/')) cloud.bytes = bytes;
      }
      return { Contents: [] };
    });
    cloud.read.mockReset().mockImplementation(async key => cloud.objects.get(key));
  });
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  const request = () => createApp().request('/api/admin/backup-to-r2', { method: 'POST', headers });
  it('refuse un appel anonyme sans créer de copie ni témoin', async () => {
    const r = await createApp().request('/api/admin/backup-to-r2', { method: 'POST' });
    expect(r.status).toBe(401); expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(cloud.send).not.toHaveBeenCalled(); expect(readBackupChecks(getDb())).toEqual([]);
  });
  it('snapshot → chiffrement → stockage fictif → récupération → vérification isolée → témoins', async () => {
    const r = await request(), proof = await r.json();
    expect(r.status).toBe(200);
    expect(proof).toMatchObject({ ok: true, encrypted: true, restore_check: 'ok', restore_verification: { version: 1, byte_match: true, integrity: 'ok', foreign_keys: 'ok', required_schema: 'ok', current_versions: 'ok', schema_profile:'service-crm-2026-09-26' } });
    expect(readBackupChecks(getDb()).find(check=>check.name==='backup')?.restore_verification?.schema_profile).toBe('service-crm-2026-09-26');
    const stored=getDb().prepare("SELECT details_json FROM operation_checks WHERE name='backup'").get() as {details_json:string};expect(JSON.parse(stored.details_json).restore_verification.schema_profile).toBe('service-crm-2026-09-26');
    expect(JSON.parse(cloud.objects.get(proof.manifest_key)!.toString()).checks.schema_profile).toBe('service-crm-2026-09-26');
    expect(cloud.bytes.subarray(0, 8).toString()).toBe('OSDBAK01');
    expect(cloud.bytes.includes(Buffer.from('personne@example.test'))).toBe(false);
    expect(cloud.read).toHaveBeenCalledTimes(2); expect(cloud.destroy).toHaveBeenCalledOnce();
    expect(proof.verified_manifest).toBe(true); expect(cloud.objects.has(proof.manifest_key)).toBe(true);
    expect(readBackupChecks(getDb()).find(x => x.name === 'backup_attempt')?.state).toBe('success');
    expect(JSON.stringify(proof)).not.toContain('personne'); expect(JSON.stringify(proof)).not.toContain(dir);
  });
  it('préserve le succès précédent et refuse une copie corrompue avant tout élagage', async () => {
    const previous = { encrypted: true, restore_check: 'ok', size_bytes: 111 };
    getDb().prepare("INSERT INTO operation_checks VALUES('backup',?,?)").run(Date.now() - 1000, JSON.stringify(previous));
    cloud.read.mockImplementation(async () => { const changed = Buffer.from(cloud.bytes); changed[changed.length - 1] ^= 1; return changed; });
    const r = await request();
    expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'backup_failed_restore' });
    expect(cloud.send.mock.calls.some(([command]) => command.constructor.name === 'DeleteObjectCommand' || command.constructor.name === 'ListObjectsV2Command')).toBe(false);
    expect(readBackupChecks(getDb()).find(x => x.name === 'backup')?.size_bytes).toBe(111);
    expect(readBackupChecks(getDb()).find(x => x.name === 'backup_attempt')?.state).toBe('failed');
  });
  it('signale un lien cassé de la base source sans altérer la source ni valider la restauration', async () => {
    const db = getDb();
    db.exec("PRAGMA foreign_keys=OFF; INSERT INTO sessions VALUES('fictif',999,1790420000000,1790410000000); PRAGMA foreign_keys=ON");
    const r = await request();
    expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'backup_foreign_keys_failed' });
    expect(db.prepare("SELECT COUNT(*) n FROM sessions WHERE token='fictif'").get()).toEqual({ n: 1 });
    expect(readBackupChecks(db).find(x => x.name === 'backup')).toBeUndefined();
  });
  it('ne divulgue pas une erreur fournisseur brute et libère le verrou pour une reprise', async () => {
    cloud.send.mockRejectedValueOnce(new Error('SECRET_FICTIF /chemin/prive'));
    const r = await request();
    expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'backup_failed_upload' });
    const retry = await request(); expect(retry.status).toBe(200);
  });
  it('conserve la preuve de copie validée lorsque seul l’élagage échoue', async () => {
    const original = cloud.send.getMockImplementation()!;
    cloud.send.mockImplementation(async command => {
      if (command.constructor.name === 'ListObjectsV2Command') throw new Error('erreur privée de stockage');
      return original(command);
    });
    const r = await request(), body = await r.json();
    expect(r.status).toBe(503); expect(body).toMatchObject({ restore_check: 'ok', verified_manifest: true, retention_status: 'error' });
    expect(readBackupChecks(getDb()).find(x => x.name === 'backup')?.restore_verification?.byte_match).toBe(true);
    expect(readBackupChecks(getDb()).find(x => x.name === 'backup_attempt')).toMatchObject({ state: 'failed', phase: 'retention', error: 'backup_failed_retention' });
  });
  it('refuse de valider un témoin indépendant dont la relecture diffère', async () => {
    cloud.read.mockImplementation(async key => key.includes('/verified/') ? Buffer.from('{}') : cloud.objects.get(key));
    const r = await request(); expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'backup_failed_manifest' });
    expect(readBackupChecks(getDb()).find(x => x.name === 'backup')).toBeUndefined();
  });
  it('parcourt les pages d’élagage et conserve sa nouvelle copie même avec des dates anciennes', async () => {
    const original = cloud.send.getMockImplementation()!;
    cloud.send.mockImplementation(async command => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        if (!command.input.ContinuationToken) return { IsTruncated: true, NextContinuationToken: 'page-fictive-2', Contents: [...cloud.objects.keys()].map(Key => ({ Key, LastModified: new Date(0) })) };
        return { Contents: [{ Key: 'backups/ancien-fictif', LastModified: new Date(0) }, { Key: 'backups/date-inconnue' }] };
      }
      return original(command);
    });
    const r = await request(), proof = await r.json();
    expect(r.status).toBe(200); expect(proof.pruned_count).toBe(1);
    const deleted = cloud.send.mock.calls.filter(([command]) => command.constructor.name === 'DeleteObjectCommand').map(([command]) => command.input.Key);
    expect(deleted).toEqual(['backups/ancien-fictif']);
    expect(cloud.objects.has(proof.r2_key)).toBe(true); expect(cloud.objects.has(proof.manifest_key)).toBe(true);
  });
});
