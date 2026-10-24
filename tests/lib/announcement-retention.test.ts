// Effacement des inscriptions « être prévenu » : 7 jours sans confirmation, 12 mois après l'annonce (jour civil de
// Zurich), fin du 30.06.2027 sans annonce. Adresses d'exemple seulement.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, getDb } from '../../src/lib/db.js';
import { runCleanup, runFullCleanup, readCleanupProof } from '../../src/lib/cleanup.js';
import { CLEANUP_CATEGORIES } from '../../src/lib/cleanup-types.js';
import { ANNOUNCEMENT_FALLBACK_END, announcementAnniversaryCutoff, applyAnnouncementRetention } from '../../src/lib/announcement-retention.js';
import { CONFIRMATION_TTL_MS, PENDING_RETENTION_MS } from '../../src/lib/announcements.js';
import { swissMidnight } from '../../src/lib/crm-period.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 26, 8, 0, 0);
let n = 0;
type Row = { requested: number; confirmed?: number | null; announced?: number | null; token?: boolean };
function insert(row: Row): number {
  n += 1;
  const token = row.token ?? row.confirmed == null;
  return Number(getDb().prepare('INSERT INTO announcement_subscriptions(email,lang,subject,requested_at,confirmed_at,announced_at,token_hash,token_expires_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(`personne${n}@example.com`, 'fr', 'finma-historique', row.requested, row.confirmed ?? null, row.announced ?? null, token ? String(n % 10).repeat(64) : null, token ? row.requested + CONFIRMATION_TTL_MS : null).lastInsertRowid);
}
const ids = () => (getDb().prepare('SELECT id FROM announcement_subscriptions ORDER BY id').all() as Array<{ id: number }>).map(r => r.id);

describe('Conservation des inscriptions « être prévenu »', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'osd-annonces-conservation-')); process.env.DATABASE_PATH = join(dir, 'fictive.sqlite'); getDb(); });
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.DATABASE_PATH; });

  it('demande non confirmée effacée 7 jours après la demande, pas avant ; une inscription confirmée reste', () => {
    const pending = insert({ requested: T0 });
    const confirmed = insert({ requested: T0, confirmed: T0 + DAY });
    expect(applyAnnouncementRetention(getDb(), T0 + PENDING_RETENTION_MS - 1)).toEqual({ deleted: 0 });
    expect(ids()).toEqual([pending, confirmed]);
    expect(applyAnnouncementRetention(getDb(), T0 + PENDING_RETENTION_MS)).toEqual({ deleted: 1 });
    expect(ids()).toEqual([confirmed]);
  });

  it('jetons échus : leur empreinte disparaît, celle d’un jeton encore valable reste', () => {
    const old = insert({ requested: T0 });
    const fresh = insert({ requested: T0 + 3 * DAY });
    applyAnnouncementRetention(getDb(), T0 + CONFIRMATION_TTL_MS);
    const rows = getDb().prepare('SELECT id, token_hash, token_expires_at FROM announcement_subscriptions ORDER BY id').all() as Array<{ id: number; token_hash: string | null; token_expires_at: number | null }>;
    expect(rows.map(r => [r.id, r.token_hash === null, r.token_expires_at === null])).toEqual([[old, true, true], [fresh, false, false]]);
  });

  it('inscription annoncée : effacée au début du jour anniversaire à Zurich (12 mois), pas la veille', () => {
    const announced = swissMidnight('2027-03-15') + 10 * 3_600_000;
    const kept = insert({ requested: T0, confirmed: T0 + DAY, announced });
    const later = insert({ requested: T0, confirmed: T0 + DAY, announced: swissMidnight('2027-03-16') + 60_000 });
    expect(applyAnnouncementRetention(getDb(), swissMidnight('2028-03-15') - 1)).toEqual({ deleted: 0 });
    expect(applyAnnouncementRetention(getDb(), swissMidnight('2028-03-15'))).toEqual({ deleted: 1 });
    expect(ids()).toEqual([later]);
    expect(ids()).not.toContain(kept);
  });

  it('année bissextile : le 29.02.2028, les annonces jusqu’au 28.02.2027 sont échues, pas celles du 01.03.2027', () => {
    const now = swissMidnight('2028-02-29') + 3_600_000;
    expect(announcementAnniversaryCutoff(now)).toBe(swissMidnight('2027-03-01'));
    const echue = insert({ requested: T0, confirmed: T0 + DAY, announced: swissMidnight('2027-02-28') + 3_600_000 });
    const gardee = insert({ requested: T0, confirmed: T0 + DAY, announced: swissMidnight('2027-03-01') + 3_600_000 });
    expect(applyAnnouncementRetention(getDb(), now)).toEqual({ deleted: 1 });
    expect(ids()).toEqual([gardee]);
    expect(ids()).not.toContain(echue);
  });

  it('sans annonce : tout est effacé à la fin du 30.06.2027, heure de Zurich (22:00 UTC), pas une milliseconde avant', () => {
    expect(ANNOUNCEMENT_FALLBACK_END).toBe(Date.UTC(2027, 5, 30, 22, 0, 0));
    const recent = Date.UTC(2027, 5, 29, 9, 0, 0);
    const confirmed = insert({ requested: T0, confirmed: T0 + DAY });
    const pendingRecent = insert({ requested: recent });
    const announcedBefore = insert({ requested: T0, confirmed: T0 + DAY, announced: Date.UTC(2027, 4, 1, 8, 0, 0) });
    expect(applyAnnouncementRetention(getDb(), ANNOUNCEMENT_FALLBACK_END - 1)).toEqual({ deleted: 0 });
    expect(ids()).toEqual([confirmed, pendingRecent, announcedBefore]);
    expect(applyAnnouncementRetention(getDb(), ANNOUNCEMENT_FALLBACK_END)).toEqual({ deleted: 2 });
    // Une inscription dont l'annonce est partie suit la règle des 12 mois, pas la date du 30.06.2027.
    expect(ids()).toEqual([announcedBefore]);
    expect(applyAnnouncementRetention(getDb(), swissMidnight('2028-05-01') - 1)).toEqual({ deleted: 0 });
    expect(applyAnnouncementRetention(getDb(), swissMidnight('2028-05-01'))).toEqual({ deleted: 1 });
    expect(ids()).toEqual([]);
  });

  it('date mal formée : rien n’est effacé, la catégorie signale timestamp_format', () => {
    const db = getDb();
    insert({ requested: T0 });
    db.pragma('ignore_check_constraints=ON');
    db.prepare("INSERT INTO announcement_subscriptions(email,lang,subject,requested_at) VALUES('format@example.com','fr','finma-historique','2026-10-26')").run();
    db.pragma('ignore_check_constraints=OFF');
    expect(applyAnnouncementRetention(db, T0 + 30 * DAY)).toEqual({ deleted: 0, error: 'timestamp_format' });
    expect(ids()).toHaveLength(2);
    expect(runCleanup(db, T0 + 30 * DAY).entries.find(e => e.name === 'announcement_subscriptions')).toMatchObject({ status: 'error', error: 'timestamp_format', deleted: 0 });
  });

  it('nettoyage complet : catégorie announcement_subscriptions comptée, témoin relisible à 19 catégories', async () => {
    insert({ requested: T0 });
    insert({ requested: T0, confirmed: T0 + DAY });
    const proof = await runFullCleanup(getDb(), T0 + PENDING_RETENTION_MS);
    expect(proof.ok).toBe(true);
    expect(proof.entries.find(e => e.name === 'announcement_subscriptions')).toEqual({ name: 'announcement_subscriptions', deleted: 1, status: 'ok', unit: 'rows' });
    expect(CLEANUP_CATEGORIES.filter(name => name !== 'cleanup_proof')).toHaveLength(19);
    expect(proof.entries).toHaveLength(19);
    expect(readCleanupProof(getDb())).toEqual(proof);
    // Un témoin d'avant ce lot (18 catégories) ne prouve plus la purge : la minuterie refait un passage.
    const legacy = proof.entries.filter(e => e.name !== 'announcement_subscriptions');
    getDb().prepare("UPDATE operation_checks SET details_json=? WHERE name='cleanup'").run(JSON.stringify({ ...proof, entries: legacy, totalDeleted: legacy.reduce((sum, e) => sum + e.deleted, 0) }));
    expect(readCleanupProof(getDb())).toBeNull();
  });

  it('table absente ou panne SQL : erreur database_error, les autres catégories continuent', () => {
    const db = getDb();
    db.exec('DROP TABLE announcement_subscriptions');
    const result = runCleanup(db, T0);
    expect(result.ok).toBe(false);
    expect(result.entries.find(e => e.name === 'announcement_subscriptions')).toMatchObject({ status: 'error', error: 'database_error', deleted: 0 });
    expect(result.entries.find(e => e.name === 'sessions')).toMatchObject({ status: 'ok' });
    expect(JSON.stringify(result)).not.toMatch(/no such table|announcement_subscriptions\b.*SQL/i);
  });
});
