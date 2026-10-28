// Registre des effacements des inscriptions « être prévenu » : une restauration de sauvegarde ne ramène jamais une
// inscription effacée (désinscription ou purge), sans jamais toucher une demande plus récente au même identifiant.
// Adresses d'exemple seulement (example.com), clés fictives, aucun envoi réel (pas de clé Resend).
import '../helpers/session-origin.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { closeDb, getDb } from '../../src/lib/db.js';
import { readCleanupProof, runFullCleanup } from '../../src/lib/cleanup.js';
import { createApp } from '../../src/index.js';
import { settleAnnouncementDeliveries } from '../../src/routes/announcements.js';
import {
  confirmAnnouncement, eraseAnnouncementSubscription, registerAnnouncementRequest, type AnnouncementDelivery,
} from '../../src/lib/announcements.js';
import {
  BACKUP_MARGIN_MS, BACKUP_RETENTION_MS, ERASURE_KEEP_MIN_MS, AnnouncementRegistryError,
  readAnnouncementErasureMirror, reapplyAnnouncementErasures, syncAnnouncementErasureMirror,
} from '../../src/lib/announcement-erasures.js';

const DAY = 86_400_000, HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 26, 8, 0, 0);
const ROOT = process.cwd();

describe('Registre des effacements des inscriptions', () => {
  let dir: string, dbPath: string, db: Database.Database, mirror: string;
  const rows = () => db.prepare('SELECT id, email, requested_at FROM announcement_subscriptions ORDER BY id').all() as Array<{ id: number; email: string; requested_at: number }>;
  const registry = () => db.prepare('SELECT subject_id, erased_at FROM announcement_erasures ORDER BY erased_at, subject_id').all();
  const request = (email: string, now: number) => registerAnnouncementRequest(db, { email, lang: 'fr', subject: 'finma-historique' }, now) as AnnouncementDelivery;
  const restore = (snapshot: string) => {
    closeDb();
    copyFileSync(snapshot, dbPath);
    for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
    db = getDb();
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'osd-annonces-registre-'));
    dbPath = join(dir, 'fictive.sqlite');
    mirror = join(dir, 'retention', 'announcement-erasures.json');
    process.env.DATABASE_PATH = dbPath;
    vi.stubEnv('SESSION_SECRET', 'cle-de-session-fictive-pour-les-tests-0123456789');
    db = getDb();
  });
  afterEach(async () => {
    await settleAnnouncementDeliveries();
    vi.useRealTimers();
    vi.restoreAllMocks();
    closeDb();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.OSD_SKIP_ERASURE_REPLAY;
  });

  it('désinscription puis restauration d’une sauvegarde antérieure : la ligne disparaît au démarrage', async () => {
    const delivery = request('personne@example.com', T0);
    expect(confirmAnnouncement(db, delivery.token, T0 + HOUR)).toMatchObject({ confirmed: true });
    const snapshot = join(dir, 'instantane.sqlite');
    await db.backup(snapshot);
    expect(eraseAnnouncementSubscription(db, { id: delivery.id, requestedAt: T0 }, T0 + DAY)).toMatchObject({ erased: true });
    syncAnnouncementErasureMirror(db);
    expect(rows()).toEqual([]);
    expect(readAnnouncementErasureMirror(mirror)).toEqual([{ subject_id: delivery.id, erased_at: T0 + DAY }]);
    restore(snapshot);
    expect(rows().map(r => r.id)).toEqual([delivery.id]);
    expect(registry()).toEqual([]);
    expect(reapplyAnnouncementErasures(db, T0 + 2 * DAY, 'startup')).toEqual({
      status: 'ok', origin: 'startup', checked_at: T0 + 2 * DAY, issues: [], mirror_entries: 1, due: 1, future: 0, reapplied: 1, retired: 0, mirror: 'unchanged',
    });
    expect(rows()).toEqual([]);
    expect(registry()).toEqual([{ subject_id: delivery.id, erased_at: T0 + DAY }]);
  });

  it('purge automatique puis restauration : la ligne disparaît au démarrage, la copie est écrite par le nettoyage', async () => {
    const delivery = request('attente@example.com', T0);
    const snapshot = join(dir, 'instantane.sqlite');
    await db.backup(snapshot);
    const proof = await runFullCleanup(db, T0 + 7 * DAY);
    expect(proof.entries.find(e => e.name === 'announcement_subscriptions')).toEqual({ name: 'announcement_subscriptions', deleted: 1, status: 'ok', unit: 'rows' });
    expect(readAnnouncementErasureMirror(mirror)).toEqual([{ subject_id: delivery.id, erased_at: T0 + 7 * DAY }]);
    restore(snapshot);
    expect(rows().map(r => r.id)).toEqual([delivery.id]);
    expect(reapplyAnnouncementErasures(db, T0 + 7 * DAY + HOUR, 'startup')).toMatchObject({ status: 'ok', reapplied: 1 });
    expect(rows()).toEqual([]);
  });

  it('nouvelle demande au même identifiant après restauration : conservée, et l’ancien lien de désinscription ne l’efface pas', async () => {
    const snapshot = join(dir, 'instantane-vide.sqlite');
    await db.backup(snapshot);
    const old = request('personne@example.com', T0);
    eraseAnnouncementSubscription(db, { id: old.id, requestedAt: T0 }, T0 + HOUR);
    syncAnnouncementErasureMirror(db);
    restore(snapshot);
    // Démarrage : rien à effacer (la ligne n'existe pas dans la sauvegarde), l'entrée rejoint la table restaurée.
    expect(reapplyAnnouncementErasures(db, T0 + 2 * HOUR, 'startup')).toMatchObject({ status: 'ok', reapplied: 0 });
    const fresh = request('autre@example.com', T0 + 3 * HOUR);
    expect(fresh.id).toBe(old.id);
    expect(reapplyAnnouncementErasures(db, T0 + 4 * HOUR, 'cleanup')).toMatchObject({ status: 'ok', reapplied: 0 });
    expect(await runFullCleanup(db, T0 + 5 * HOUR)).toMatchObject({ ok: true });
    expect(rows()).toEqual([{ id: old.id, email: 'autre@example.com', requested_at: T0 + 3 * HOUR }]);
    expect(eraseAnnouncementSubscription(db, { id: old.id, requestedAt: T0 }, T0 + 6 * HOUR)).toEqual({ erased: false, lang: null });
    expect(rows()).toHaveLength(1);
  });

  it('même cas si le rejeu du démarrage a échoué : une demande postérieure à l’effacement n’est jamais touchée', async () => {
    const snapshot = join(dir, 'instantane-vide.sqlite');
    await db.backup(snapshot);
    const old = request('personne@example.com', T0);
    eraseAnnouncementSubscription(db, { id: old.id, requestedAt: T0 }, T0 + HOUR);
    syncAnnouncementErasureMirror(db);
    restore(snapshot);
    const fresh = request('autre@example.com', T0 + 2 * HOUR);
    expect(fresh.id).toBe(old.id);
    expect(reapplyAnnouncementErasures(db, T0 + 3 * HOUR, 'cleanup')).toMatchObject({ status: 'ok', reapplied: 0 });
    expect(rows().map(r => r.email)).toEqual(['autre@example.com']);
  });

  it('copie illisible : service ouvert, désinscription acceptée, copie jamais réécrite, témoin rouge', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID', 'environnement-fictif');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const delivery = request('personne@example.com', T0);
    mkdirSync(join(dir, 'retention'), { recursive: true });
    writeFileSync(mirror, '{');
    expect(reapplyAnnouncementErasures(db, T0 + HOUR, 'startup')).toMatchObject({ status: 'error', issues: ['mirror_unreadable'], reapplied: 0 });
    // Le service répond : une demande (mail impossible sans clé, donc demande retirée) et une désinscription.
    // Le service date son effacement à l'horloge : figée entre T0 + 1 h et T0 + 2 h, sinon il tombe après les
    // nettoyages de T0 + 3 h et T0 + 4 h dès que la date réelle les dépasse (rouge depuis le 26.10.2026).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 90 * 60_000);
    const res = await createApp().request('https://www.openswissdata.com/api/announcements/request', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://www.openswissdata.com', 'x-real-ip': '10.30.0.1' },
      body: JSON.stringify({ email: 'autre@example.com', lang: 'fr', subject: 'finma-historique', consent: true }),
    });
    await settleAnnouncementDeliveries();
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(eraseAnnouncementSubscription(db, { id: delivery.id, requestedAt: T0 }, T0 + 2 * HOUR)).toMatchObject({ erased: true });
    expect(() => syncAnnouncementErasureMirror(db)).toThrow(AnnouncementRegistryError);
    expect(readFileSync(mirror, 'utf8')).toBe('{');
    expect((registry() as unknown[]).length).toBe(2);
    const proof = await runFullCleanup(db, T0 + 3 * HOUR);
    expect(proof.ok).toBe(false);
    expect(proof.entries.find(e => e.name === 'announcement_subscriptions')).toMatchObject({ status: 'error', error: 'storage_error' });
    expect(readCleanupProof(db)).toEqual(proof);
    expect(readFileSync(mirror, 'utf8')).toBe('{');
    // Copie réparée : tout ce que la table a retenu y revient au passage suivant.
    rmSync(mirror);
    expect(await runFullCleanup(db, T0 + 4 * HOUR)).toMatchObject({ ok: true });
    expect(readAnnouncementErasureMirror(mirror)).toHaveLength(2);
  });

  it('copie remplacée par un lien ou dossier invalide : signalé, rien d’effacé ni d’écrit', () => {
    request('personne@example.com', T0);
    writeFileSync(join(dir, 'retention'), 'pas un dossier');
    expect(reapplyAnnouncementErasures(db, T0 + HOUR, 'startup')).toMatchObject({ status: 'error', issues: ['registry_path_invalid'] });
    expect(rows()).toHaveLength(1);
    expect(readFileSync(join(dir, 'retention'), 'utf8')).toBe('pas un dossier');
  });

  it('la copie ne contient qu’un identifiant interne et une date : ni adresse, ni empreinte, ni jeton', async () => {
    const a = request('personne@example.com', T0), b = request('autre@example.com', T0 + 1);
    eraseAnnouncementSubscription(db, { id: a.id, requestedAt: T0 }, T0 + HOUR);
    await runFullCleanup(db, T0 + 8 * DAY);
    const text = readFileSync(mirror, 'utf8');
    expect(text).not.toMatch(/@|example|personne|autre|token|hash/i);
    expect(text).not.toContain(a.token);
    expect(text).not.toContain(b.tokenHash);
    const parsed = JSON.parse(text) as { version: number; entries: Array<Record<string, unknown>> };
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'version']);
    expect(parsed.entries).toEqual([{ subject_id: a.id, erased_at: T0 + HOUR }, { subject_id: b.id, erased_at: T0 + 8 * DAY }]);
    for (const entry of parsed.entries) expect(Object.keys(entry).sort()).toEqual(['erased_at', 'subject_id']);
  });

  it('retrait des entrées : seulement après 180 jours ET un élagage des sauvegardes prouvé au-delà de 30 + 7 jours', () => {
    const now = T0 + 400 * DAY;
    const insert = db.prepare('INSERT INTO announcement_erasures(subject_id, erased_at) VALUES(?, ?)');
    insert.run(1, now - ERASURE_KEEP_MIN_MS - DAY); // ancienne, élagage prouvé après elle : retirée
    insert.run(2, now - ERASURE_KEEP_MIN_MS + DAY); // moins de 180 jours : gardée
    const backup = (checkedAt: number, retention: 'ok' | 'error') => db.prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('backup',?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json")
      .run(checkedAt, JSON.stringify({ encrypted: true, restore_check: 'ok', retention_status: retention }));
    // Sans témoin de sauvegarde : rien n'est retiré.
    expect(reapplyAnnouncementErasures(db, now, 'cleanup')).toMatchObject({ status: 'ok', retired: 0 });
    // Élagage en échec : rien n'est retiré.
    backup(now - HOUR, 'error');
    expect(reapplyAnnouncementErasures(db, now, 'cleanup')).toMatchObject({ retired: 0 });
    // Dernière sauvegarde réussie trop proche de l'effacement (sauvegardes arrêtées depuis) : gardée.
    backup(now - ERASURE_KEEP_MIN_MS - DAY + BACKUP_RETENTION_MS + BACKUP_MARGIN_MS - 1, 'ok');
    expect(reapplyAnnouncementErasures(db, now, 'cleanup')).toMatchObject({ retired: 0 });
    expect(registry()).toHaveLength(2);
    backup(now - HOUR, 'ok');
    expect(reapplyAnnouncementErasures(db, now, 'cleanup')).toMatchObject({ status: 'ok', retired: 1, mirror: 'updated' });
    expect(registry()).toEqual([{ subject_id: 2, erased_at: now - ERASURE_KEEP_MIN_MS + DAY }]);
    expect(readAnnouncementErasureMirror(mirror)).toEqual([{ subject_id: 2, erased_at: now - ERASURE_KEEP_MIN_MS + DAY }]);
  });

  it('entrée datée dans le futur : ignorée, signalée, rien retiré ; interrupteur : suspendu, copie intacte', async () => {
    const delivery = request('personne@example.com', T0);
    mkdirSync(join(dir, 'retention'), { recursive: true });
    writeFileSync(mirror, JSON.stringify({ version: 1, entries: [{ subject_id: delivery.id, erased_at: T0 + 30 * DAY }] }));
    expect(reapplyAnnouncementErasures(db, T0 + DAY, 'startup')).toMatchObject({ status: 'error', issues: ['replay_pending'], future: 1, reapplied: 0 });
    expect(rows()).toHaveLength(1);
    expect((await runFullCleanup(db, T0 + DAY)).entries.find(e => e.name === 'announcement_subscriptions')).toMatchObject({ status: 'error', error: 'replay_pending' });
    process.env.OSD_SKIP_ERASURE_REPLAY = '1';
    const before = readFileSync(mirror, 'utf8');
    expect(reapplyAnnouncementErasures(db, T0 + 40 * DAY, 'startup')).toMatchObject({ status: 'suspended' });
    expect(rows()).toHaveLength(1);
    expect((await runFullCleanup(db, T0 + 2 * DAY)).entries.find(e => e.name === 'announcement_subscriptions')).toMatchObject({ status: 'error', error: 'registry_suspended' });
    expect(readFileSync(mirror, 'utf8')).toBe(before);
  });

  it('repères figés : élagage des sauvegardes à 30 jours, rejeu au démarrage avant l’ouverture du port', () => {
    expect(BACKUP_RETENTION_MS).toBe(30 * DAY);
    expect(readFileSync(join(ROOT, 'src/routes/admin.ts'), 'utf8')).toContain('const cutoff = Date.now() - 30 * 24 * 3600 * 1000;');
    const index = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
    const replay = index.indexOf('reapplyAnnouncementErasures(database, Date.now(), "startup")');
    expect(replay).toBeGreaterThan(index.indexOf('reapplyErasures(database, Date.now(), "startup")'));
    expect(replay).toBeLessThan(index.indexOf('serve({ fetch: app.fetch'));
  });
});
