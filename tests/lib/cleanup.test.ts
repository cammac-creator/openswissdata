import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { runCleanup, runFullCleanup, readCleanupProof } from '../../src/lib/cleanup.js';
import { purgeExpiredBronze } from '../../src/lib/bronze-retention.js';
import { renderCleanupStatus, cleanupSchedule } from '../../web/src/lib/cleanup-status.js';
import { bronze } from '../../src/lib/crm-source.js';

const NOW = Date.UTC(2026, 8, 26, 12), DAY = 86_400_000;
describe('Conservation appliquée et témoin du nettoyage', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'osd-cleanup-'));
    process.env.DATABASE_PATH = join(dir, 'fictive.sqlite');
    const db = getDb();
    db.prepare("INSERT INTO customers(email,created_at) VALUES('personne@example.test',?)").run(NOW);
    for (const [token, expiry] of [['expired', NOW - 1], ['boundary', NOW], ['active', NOW + DAY]]) {
      db.prepare('INSERT INTO sessions(token,customer_id,expires_at,created_at) VALUES(?,1,?,?)').run(token, expiry, NOW - DAY);
    }
    for (const age of [179, 181]) db.prepare("INSERT INTO events(kind,name,ts) VALUES('custom',?,?)").run(String(age), NOW - age * DAY);
    db.prepare("INSERT INTO orders(customer_id,stripe_session_id,amount_chf,items_json,created_at) VALUES(1,'cs_test_retention',29900,'[]',?)").run(NOW - 400 * DAY);
  });
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.DATABASE_PATH; });
  const fixture = (path: string) => { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'fictif.enc'), 'copie fictive intacte'); };

  it('retire les expirés, garde la frontière et les commandes, distingue la table historique absente', () => {
    const db = getDb(), result = runCleanup(db, NOW);
    expect(result.ok).toBe(true);
    expect(result.entries.find(e => e.name === 'request_log')).toMatchObject({ status: 'not_applicable', deleted: 0 });
    expect(result.entries.find(e => e.name === 'magic_links')).toMatchObject({ status: 'not_applicable', deleted: 0 });
    expect(db.prepare('SELECT token FROM sessions ORDER BY token').all()).toEqual([{ token: 'active' }, { token: 'boundary' }]);
    expect(db.prepare('SELECT name FROM events').all()).toEqual([{ name: '179' }]);
    expect(db.prepare('SELECT COUNT(*) n FROM orders').get()).toEqual({ n: 1 });
    expect(runCleanup(db, NOW).totalDeleted).toBe(0);
  });
  it('ne masque pas un refus SQL et poursuit les catégories indépendantes', () => {
    const db = getDb();
    db.exec("CREATE TRIGGER stop_events BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'chemin privé et message fictif'); END");
    const result = runCleanup(db, NOW);
    expect(result.ok).toBe(false);
    expect(result.entries.find(e => e.name === 'events')).toMatchObject({ status: 'error', error: 'database_error' });
    expect(result.entries.find(e => e.name === 'sessions')?.deleted).toBe(1);
    expect(JSON.stringify(result)).not.toContain('chemin privé');
  });
  it('considère une table obligatoire absente comme une panne', () => {
    const db = getDb(); db.exec('DROP TABLE events');
    expect(runCleanup(db, NOW).ok).toBe(false);
  });
  it('refuse des dates en secondes ou en texte sans supprimer les données de la catégorie', () => {
    const db = getDb(); db.exec('CREATE TABLE request_log(timestamp INTEGER)');
    for (const date of [Math.floor(NOW / 1000), '2026-01-01T00:00:00Z']) {
      db.exec('DELETE FROM request_log'); db.prepare('INSERT INTO request_log VALUES(?)').run(date);
      const result = runCleanup(db, NOW);
      expect(result.entries.find(e => e.name === 'request_log')).toMatchObject({ status: 'error', error: 'timestamp_format', deleted: 0 });
      expect(db.prepare('SELECT COUNT(*) n FROM request_log').get()).toEqual({ n: 1 });
    }
  });
  it('utilise le bronze de la base réellement ouverte même si DATABASE_PATH indique autre chose', async () => {
    closeDb();
    const chosen = join(dir, 'autre-base', 'fictive.sqlite'); getDb(chosen);
    process.env.OSD_BACKUP_KEY = 'b'.repeat(64);
    try {
      await bronze('fictif', Buffer.from('aucune donnée réelle'));
      expect(existsSync(join(dir, 'autre-base', 'bronze', 'dashboard'))).toBe(true);
      expect(existsSync(join(dir, 'bronze'))).toBe(false);
      const result = await runFullCleanup(getDb());
      expect(result.entries.find(e => e.name === 'bronze_dashboard')?.status).toBe('ok');
    } finally { delete process.env.OSD_BACKUP_KEY; }
  });
  it('refuse une base absente pour le nettoyage sans créer de fichier ou dossier', () => {
    closeDb(); const missing = join(dir, 'absent', 'fictive.sqlite');
    expect(() => getDb(missing, { fileMustExist: true })).toThrow();
    expect(existsSync(join(dir, 'absent'))).toBe(false);
  });
  it('purge aussi la table historique si elle existe et signale un schéma invalide', () => {
    const db = getDb();
    db.exec('CREATE TABLE request_log(timestamp INTEGER)');
    for (const age of [29, 31]) db.prepare('INSERT INTO request_log VALUES(?)').run(NOW - age * DAY);
    expect(runCleanup(db, NOW).entries.find(e => e.name === 'request_log')).toMatchObject({ status: 'ok', deleted: 1 });
    db.exec('ALTER TABLE request_log RENAME COLUMN timestamp TO autre');
    expect(runCleanup(db, NOW).entries.find(e => e.name === 'request_log')?.status).toBe('error');
  });
  it('purge les deux bronzes même sans consultation, conserve fichiers récents et sauvegardes', async () => {
    for (const compartment of ['dashboard', 'financial']) {
      for (const day of ['2026-08-26', '2026-08-27', '2026-09-26']) fixture(join(dir, 'bronze', compartment, day));
    }
    fixture(join(dir, 'backups', '2026-01-01'));
    const result = await runFullCleanup(getDb(), NOW);
    expect(result.ok).toBe(true);
    for (const compartment of ['dashboard', 'financial']) {
      expect(result.entries.find(e => e.name === `bronze_${compartment}`)).toMatchObject({ deleted: 1, unit: 'folders', status: 'ok' });
      expect(existsSync(join(dir, 'bronze', compartment, '2026-08-26'))).toBe(false);
      expect(readFileSync(join(dir, 'bronze', compartment, '2026-08-27', 'fictif.enc'), 'utf8')).toBe('copie fictive intacte');
    }
    expect(existsSync(join(dir, 'backups', '2026-01-01', 'fictif.enc'))).toBe(true);
    const proof = getDb().prepare("SELECT details_json FROM operation_checks WHERE name='cleanup'").get() as { details_json: string };
    expect(JSON.parse(proof.details_json)).toEqual(result);
    expect(readCleanupProof(getDb())).toEqual(result);
    expect(renderCleanupStatus(result, NOW)).toContain('Nettoyage périodique vérifié');
    expect(renderCleanupStatus(result, NOW + 15 * 3_600_000)).toContain('Nettoyage à revérifier');
    expect((await runFullCleanup(getDb(), NOW)).totalDeleted).toBe(0);
  });
  it('ne présente pas un témoin incomplet ou altéré comme une preuve de réussite', async () => {
    const db = getDb(), proof = await runFullCleanup(db, NOW);
    for (const invalid of ['{', JSON.stringify({ ...proof, totalDeleted: 999 }), JSON.stringify({ ...proof, entries: [] })]) {
      db.prepare("UPDATE operation_checks SET details_json=? WHERE name='cleanup'").run(invalid);
      expect(readCleanupProof(db)).toBeNull();
    }
    expect(renderCleanupStatus(null, NOW)).toContain('Nettoyage à confirmer');
    expect(renderCleanupStatus({ ...proof, ok: false }, NOW)).toContain('Nettoyage incomplet');
  });
  it('ne laisse pas un ancien témoin vert masquer une tâche désactivée ou un échec plus récent', async () => {
    const proof = await runFullCleanup(getDb(), NOW);
    const items = [{ id: 1, state: 'disabled_inactivity', html_url: 'https://github.com/example/repo/actions/workflows/cleanup-expired.yml' }];
    expect(renderCleanupStatus(proof, NOW, cleanupSchedule({ available: true, items }))).toContain('Programmation à vérifier');
    items[0].state = 'active';
    const schedule = cleanupSchedule({ available: true, items, runs: [{ workflow_id: 1, created_at: new Date(NOW + 1).toISOString(), status: 'completed', conclusion: 'failure' }] });
    expect(renderCleanupStatus(proof, NOW + 2, schedule)).toContain('Dernière exécution en échec');
    expect(cleanupSchedule({ available: false })).toBeUndefined();
  });
  it('ne suit pas les liens symboliques et ignore les noms non datés ou impossibles', async () => {
    const root = join(dir, 'bronze', 'dashboard'), outside = join(dir, 'autres-donnees');
    fixture(outside); fixture(join(root, '2026-08-26')); fixture(join(root, '2025-02-30')); fixture(join(root, 'notes'));
    symlinkSync(outside, join(root, '2026-08-25'), 'dir');
    symlinkSync(outside, join(root, '2026-08-26', 'lien-interne'), 'dir');
    writeFileSync(join(root, '2020-01-01'), 'fichier non prévu pour la purge');
    expect(await purgeExpiredBronze(root, NOW)).toEqual({ deleted: 1, failed: 0 });
    expect(readFileSync(join(outside, 'fictif.enc'), 'utf8')).toBe('copie fictive intacte');
    for (const name of ['2025-02-30', 'notes', '2026-08-25', '2020-01-01']) expect(existsSync(join(root, name))).toBe(true);
  });
  it('signale une racine bronze anormale sans toucher à sa cible', async () => {
    const outside = join(dir, 'autres-donnees'); fixture(join(outside, '2026-01-01'));
    mkdirSync(join(dir, 'bronze')); symlinkSync(outside, join(dir, 'bronze', 'dashboard'), 'dir');
    const result = await runFullCleanup(getDb(), NOW);
    expect(result.ok).toBe(false);
    expect(result.entries.find(e => e.name === 'bronze_dashboard')).toMatchObject({ status: 'error', error: 'storage_error' });
    expect(existsSync(join(outside, '2026-01-01', 'fictif.enc'))).toBe(true);
  });
  it('refuse de déclarer un succès si le témoin ne peut pas être conservé', async () => {
    getDb().exec('DROP TABLE operation_checks');
    const result = await runFullCleanup(getDb(), NOW);
    expect(result.ok).toBe(false);
    expect(result.entries.at(-1)).toMatchObject({ name: 'cleanup_proof', error: 'proof_error' });
  });
  it('refuse aussi un lien symbolique sur le dossier bronze parent', async () => {
    const outside = join(dir, 'autre-bronze'); fixture(join(outside, 'dashboard', '2026-01-01'));
    symlinkSync(outside, join(dir, 'bronze'), 'dir');
    const result = await runFullCleanup(getDb(), NOW);
    expect(result.ok).toBe(false);
    expect(existsSync(join(outside, 'dashboard', '2026-01-01', 'fictif.enc'))).toBe(true);
  });
  it('regroupe les passages concurrents au lieu de compter deux fois les mêmes suppressions', async () => {
    const first = runFullCleanup(getDb(), NOW), second = runFullCleanup(getDb(), NOW + 1);
    expect(second).toBe(first);
    const result = await first;
    expect(result.checked_at).toBe(NOW);
    expect(result.entries.find(e => e.name === 'sessions')?.deleted).toBe(1);
  });
});
