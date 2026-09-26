import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, copyFileSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { inspectRestoredBackup } from '../../src/lib/backup-inspection.js';
import { verifyRestoredBackup } from '../../src/lib/backup-verification.js';
import { readBackupChecks, writeBackupAttempt } from '../../src/lib/backup-state.js';
import { renderBackupStatus } from '../../web/src/lib/backup-status.js';

describe('Restauration isolée et preuve explicite', () => {
  let dir: string, source: string, restored: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'osd-restore-fictif-'));
    source = join(dir, 'snapshot.sqlite'); restored = join(dir, 'restored.sqlite');
    const db = getDb(source);
    db.prepare("INSERT INTO customers(email,created_at) VALUES('personne@example.test',?)").run(Date.now());
    closeDb(); copyFileSync(source, restored);
  });
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });
  const modify = (sql: string) => { const db = new Database(source); try { db.exec(sql); } finally { db.close(); } copyFileSync(source, restored); };
  it('vérifie les deux fichiers en processus séparé sans modifier la copie restaurée', async () => {
    const before = readFileSync(restored);
    const proof = await verifyRestoredBackup(source, restored);
    expect(proof).toMatchObject({ version: 1, byte_match: true, integrity: 'ok', foreign_keys: 'ok', required_schema: 'ok', current_versions: 'ok' });
    expect(readFileSync(restored)).toEqual(before);
    expect(JSON.stringify(proof)).not.toContain('personne'); expect(JSON.stringify(proof)).not.toContain(dir);
  });
  it('refuse un fichier restauré différent, même s’il reste une base SQLite valide', async () => {
    const db = new Database(restored); db.exec("UPDATE customers SET locale='de'"); db.close();
    await expect(verifyRestoredBackup(source, restored)).rejects.toMatchObject({ code: 'backup_bytes_differ' });
  });
  it('détecte des liens cassés même lorsque les deux copies sont identiques', async () => {
    modify("PRAGMA foreign_keys=OFF; INSERT INTO sessions VALUES('jeton-fictif',999,1790420000000,1790410000000)");
    await expect(inspectRestoredBackup(source, restored)).rejects.toMatchObject({ code: 'backup_foreign_keys_failed' });
  });
  it('refuse un schéma incomplet sans le migrer pour masquer le problème', async () => {
    modify('DROP TABLE order_legal');
    await expect(inspectRestoredBackup(source, restored)).rejects.toMatchObject({ code: 'backup_schema_failed' });
    const db = new Database(restored, { readonly: true });
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='order_legal'").get()).toBeUndefined(); db.close();
  });
  it('détecte une version courante sans archive référencée', async () => {
    modify("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES('fictif','Fictif','fictif',0,'price_fictif','absente',1790410000000)");
    await expect(inspectRestoredBackup(source, restored)).rejects.toMatchObject({ code: 'backup_versions_failed' });
  });
  it('borne réellement la vie du sous-processus', async () => {
    await expect(verifyRestoredBackup(source, restored, 1)).rejects.toMatchObject({ code: 'backup_inspection_timeout' });
  });
  it('refuse les fichiers illisibles ou absents sans créer de base ni révéler le chemin', async () => {
    writeFileSync(source, 'source fictive invalide'); copyFileSync(source, restored);
    await expect(verifyRestoredBackup(source, restored)).rejects.toMatchObject({ code: 'backup_inspection_failed' });
    rmSync(restored);
    await expect(verifyRestoredBackup(source, restored)).rejects.toMatchObject({ message: 'backup_inspection_failed' });
    expect(existsSync(restored)).toBe(false);
  });
  it('garde le dernier succès mais signale un essai plus récent en échec ou interrompu', () => {
    const db = getDb(source), now = Date.now();
    db.prepare("INSERT INTO operation_checks VALUES('backup',?,?)").run(now - 1000, JSON.stringify({ encrypted: true, restore_check: 'ok', size_bytes: 1234 }));
    writeBackupAttempt(db, 'failed', 'restore', 'backup_failed_restore');
    expect(readBackupChecks(db)).toHaveLength(2);
    const failed = renderBackupStatus(readBackupChecks(db), now + 100);
    expect(failed).toContain('Le dernier essai de sauvegarde a échoué'); expect(failed).not.toContain('pill green');
    writeBackupAttempt(db, 'running', 'snapshot');
    expect(renderBackupStatus(readBackupChecks(db), now + 100)).toContain('contrôle en cours');
    expect(renderBackupStatus(readBackupChecks(db), now + 11 * 60_000)).toContain('semble interrompu');
  });
  it('ne transforme pas un ancien contrôle rapide en vérification approfondie', async () => {
    const db = getDb(source), now = Date.now();
    db.prepare("INSERT INTO operation_checks VALUES('backup',?,?)").run(now, JSON.stringify({ encrypted: true, restore_check: 'ok', size_bytes: 1234 }));
    expect(renderBackupStatus(readBackupChecks(db), now)).toContain('contrôle SQLite historique');
    db.prepare("UPDATE operation_checks SET details_json='{' WHERE name='backup'").run();
    expect(readBackupChecks(db)).toEqual([]);
  });
  it('ne cache pas un dernier essai illisible derrière un ancien succès vert', () => {
    const db = getDb(source), now = Date.now();
    db.prepare("INSERT INTO operation_checks VALUES('backup',?,?)").run(now - 1000, JSON.stringify({ encrypted: true, restore_check: 'ok' }));
    db.prepare("INSERT INTO operation_checks VALUES('backup_attempt',?,'{')").run(now);
    expect(readBackupChecks(db)).toEqual([]);
    expect(renderBackupStatus(readBackupChecks(db), now)).not.toContain('pill green');
  });
  it('distingue une copie validée dont l’élagage reste à reprendre', () => {
    const now = Date.now();
    const html = renderBackupStatus([{ name: 'backup', checked_at: now, encrypted: true, restore_check: 'ok', retention_status: 'error' }, { name: 'backup_attempt', checked_at: now, state: 'failed', phase: 'retention', error: 'backup_failed_retention' }], now);
    expect(html).toContain('Copie restaurée ; élagage à reprendre'); expect(html).not.toContain('pill green');
    expect(html).toContain('le retrait des anciennes sauvegardes reste à reprendre');
  });
});
