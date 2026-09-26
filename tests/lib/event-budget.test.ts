import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Hono } from 'hono';
import { EventBudget, EVENT_LIMITS, queueEvent, readEventCoverage, flushEventCoverage } from '../../src/lib/event-budget.js';
import { readCrmAudience } from '../../src/lib/crm-audience.js';
import { crmPeriod, swissDay } from '../../src/lib/crm-period.js';
import { EVENT_RETENTION_MS } from '../../src/lib/event-retention.js';
import { renderCollectionStatus } from '../../web/src/lib/collection-status.js';
import type { TrackArgs } from '../../src/lib/track.js';

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), statfsSync: vi.fn() }));
const now = Date.parse('2026-09-26T12:00:00Z');
const event: TrackArgs = { kind: 'custom', origin: 'server', name: 'page_view', ua_class: 'desktop', visitor_hash: 'fictif' };
const tick = () => new Promise(r => setImmediate(r));
const schema = `CREATE TABLE events(id INTEGER PRIMARY KEY,kind TEXT,name TEXT,status INTEGER,duration_ms INTEGER,customer_id INTEGER,visitor_hash TEXT,country TEXT,referer TEXT,ua_class TEXT,meta_json TEXT,origin TEXT,ts INTEGER);
CREATE TABLE operation_checks(name TEXT PRIMARY KEY,checked_at INTEGER,details_json TEXT);`;

describe('Réserves de statistiques', () => {
  it('borne la file, puis permet sa reprise sans rendre les jetons consommés', () => {
    const b = new EventBudget();
    for (let i = 0; i < 100; i++) expect(b.take(1, 0)).toBeNull();
    expect(b.take(1, 0)).toBe('queue'); b.release(1);
    expect(b.take(1, 0)).toBe('rate'); expect(b.take(1, 99)).toBe('rate'); expect(b.take(1, 100)).toBeNull();
  });
  it('borne les octets de la file même si le débit a eu le temps de se recharger', () => {
    const b = new EventBudget();
    for (let i = 0; i < 64; i++) expect(b.take(8192, i * 60_000)).toBeNull();
    expect(b.take(1, 64 * 60_000)).toBe('queue'); b.release(8192); expect(b.take(8192, 65 * 60_000)).toBeNull();
  });
  it('compte les octets séparément du nombre et attend une recharge suffisante', () => {
    const b = new EventBudget();
    for (let i = 0; i < 32; i++) { expect(b.take(8192, 0)).toBeNull(); b.release(8192); }
    expect(b.take(8192, 468)).toBe('rate'); expect(b.take(8192, 469)).toBeNull();
  });
  it('ne gagne pas de quota quand l’horloge recule', () => {
    const b = new EventBudget();
    for (let i = 0; i < 100; i++) { expect(b.take(1, 1000)).toBeNull(); b.release(1); }
    expect(b.take(1, 0)).toBe('rate'); expect(b.take(1, 1099)).toBe('rate'); expect(b.take(1, 1100)).toBeNull();
  });
  it.each([[NaN, 0, 'format'], [-1, 0, 'format'], [1.5, 0, 'format'], [1, Infinity, 'format'], [8193, 0, 'size']])('refuse taille/horloge invalide (%s / %s)', (size, t, reason) => {
    expect(new EventBudget().take(Number(size), Number(t))).toBe(reason);
  });
});

describe('Collecte bornée et preuves agrégées', () => {
  let root: string, db: Database.Database;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'osd-budget-')); db = new Database(join(root, 'fictif.sqlite')); db.exec(schema);
    vi.mocked(statfsSync).mockReset().mockReturnValue({ bavail: 1_000_000, bsize: 4096 } as ReturnType<typeof statfsSync>);
    vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(performance, 'now').mockReturnValue(0); vi.spyOn(Date, 'now').mockReturnValue(now);
  });
  afterEach(async () => {
    await tick(); if (db.open) { flushEventCoverage(db, now); db.close(); }
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true });
  });
  const count = (db: Database.Database) => (db.prepare('SELECT COUNT(*) n FROM events').get() as {n:number}).n;
  it('capture une copie fermée et n’enregistre ni champ ajouté ni mutation ultérieure', async () => {
    const input = { ...event, name: 'avant', extra: 'invisible' }; queueEvent(db, input, now); input.name = 'apres'; await tick();
    expect(db.prepare('SELECT name,ts,origin FROM events').get()).toEqual({ name: 'avant', ts: now, origin: 'server' });
    expect(readEventCoverage(db, now)).toEqual({ available: true, checked_at: null, gaps: [], pending: false, uncertain_before: null });
  });
  it('borne cent écritures différées, documente les abandons puis reprend', async () => {
    for (let i = 0; i < 103; i++) queueEvent(db, event, now);
    expect(readEventCoverage(db, now).gaps[0]).toMatchObject({ dropped: 3, reasons: { queue: 3 } });
    await tick(); expect(count(db)).toBe(100); vi.mocked(performance.now).mockReturnValue(60_000);
    queueEvent(db, event, now + 60_000); await tick(); expect(count(db)).toBe(101);
    flushEventCoverage(db, now + 60_000); expect(readEventCoverage(db, now + 60_000).pending).toBe(false);
  });
  it('refuse les événements excessifs en octets UTF-8 avant la file', async () => {
    queueEvent(db, { ...event, meta_json: '界'.repeat(3000) }, now); await tick();
    expect(count(db)).toBe(0); expect(readEventCoverage(db, now).gaps[0].reasons).toEqual({ size: 1 });
  });
  it('ignore les nombres et dates impossibles sans empêcher le service', async () => {
    for (const bad of [{ duration_ms: NaN }, { customer_id: -1 }, { status: 1.5 }, { name: 12 }]) queueEvent(db, { ...event, ...bad } as TrackArgs, now);
    queueEvent(db, event, NaN); queueEvent(db, event, -1); await tick();
    expect(count(db)).toBe(0); expect(readEventCoverage(db, now).gaps[0].reasons).toEqual({ format: 6 });
  });
  it.each(['bas', 'illisible'])('suspend les statistiques si le disque est %s, puis reprend après le cache', async mode => {
    if (mode === 'bas') vi.mocked(statfsSync).mockReturnValue({ bavail: EVENT_LIMITS.reserveBytes - 1, bsize: 1 } as ReturnType<typeof statfsSync>);
    else vi.mocked(statfsSync).mockImplementation(() => { throw new Error('chemin confidentiel'); });
    queueEvent(db, event, now); queueEvent(db, event, now); await tick(); expect(count(db)).toBe(0);
    expect(statfsSync).toHaveBeenCalledTimes(1); expect(readEventCoverage(db, now).gaps[0].reasons).toEqual({ storage: 2 });
    vi.mocked(statfsSync).mockReturnValue({ bavail: EVENT_LIMITS.reserveBytes, bsize: 1 } as ReturnType<typeof statfsSync>);
    vi.mocked(performance.now).mockReturnValue(1001); queueEvent(db, event, now); await tick(); expect(count(db)).toBe(1);
  });
  it('ne prétend pas vérifier un disque pour une base en mémoire', async () => {
    const memory = new Database(':memory:'); memory.exec(schema); queueEvent(memory, event, now); await tick();
    expect(count(memory)).toBe(1); expect(statfsSync).not.toHaveBeenCalled(); memory.close();
  });
  it('garde les réponses HTTP disponibles malgré une panne d’écriture, sans conserver de requête sensible', async () => {
    db.exec('DROP TABLE events'); const app = new Hono(); app.get('/', c => { queueEvent(db, { ...event, name: 'prive@example.test' }, now); return c.text('Service disponible'); });
    expect((await app.request('/')).status).toBe(200); await tick(); flushEventCoverage(db, now);
    const proof = readEventCoverage(db, now); expect(proof.gaps[0].reasons).toEqual({ write: 1 }); expect(JSON.stringify(proof)).not.toContain('prive@');
  });
  it('n’attend pas un verrou d’écriture détenu ailleurs et restaure le délai du service', async () => {
    db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000');
    const other = new Database(db.name); other.exec('BEGIN IMMEDIATE');
    try {
      const start = process.hrtime.bigint(); queueEvent(db, event, now); await tick(); flushEventCoverage(db, now);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      expect(elapsed).toBeLessThan(500); expect(readEventCoverage(db, now).gaps[0].reasons).toEqual({ write: 1 });
      expect(readEventCoverage(db, now).pending).toBe(true); expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally { other.exec('ROLLBACK'); other.close(); }
    flushEventCoverage(db, now); expect(readEventCoverage(db, now).pending).toBe(false);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });
  it('réserve l’essentiel du budget aux mesures serveur malgré des déclarations publiques', async () => {
    for (let i = 0; i < 110; i++) queueEvent(db, { ...event, origin: 'client' }, now);
    for (let i = 0; i < 80; i++) queueEvent(db, event, now);
    await tick(); expect(db.prepare('SELECT origin,COUNT(*) n FROM events GROUP BY origin').all()).toEqual([{origin:'client',n:20},{origin:'server',n:80}]);
    expect(readEventCoverage(db,now).gaps[0].dropped).toBe(90);
  });
  it('arrondit une durée flottante et accepte chaque catégorie déclarée', async () => {
    for (const kind of ['api_request','custom','conversion'] as const) queueEvent(db, { ...event, kind, duration_ms:12.4 }, now);
    await tick(); expect(db.prepare('SELECT kind,duration_ms FROM events ORDER BY id').all()).toEqual(['api_request','custom','conversion'].map(kind=>({kind,duration_ms:12})));
  });
  it('garde un journal générique et borné si écriture et sauvegarde échouent ensemble', async () => {
    vi.mocked(Date.now).mockReturnValue(now + 120_000); db.exec('DROP TABLE events;DROP TABLE operation_checks');
    for(let i=0;i<3;i++)queueEvent(db,{...event,name:'confidentiel@example.test'},now);
    await tick();flushEventCoverage(db,now);
    expect(console.warn).toHaveBeenCalledTimes(1);expect(console.warn).toHaveBeenCalledWith('[mesures] enregistrement momentanément indisponible');
  });
  it('préserve une preuve historique quand une lecture SQLite échoue momentanément', () => {
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now); flushEventCoverage(db, now);
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now + 1);
    const original=db.prepare.bind(db);const spy=vi.spyOn(db,'prepare').mockImplementation(((sql:string)=>{if(sql.startsWith('SELECT checked_at'))throw new Error('SQLITE_IOERR');return original(sql)}) as typeof db.prepare);
    flushEventCoverage(db,now+1);spy.mockRestore();
    expect(readEventCoverage(db,now+1)).toMatchObject({pending:true,uncertain_before:null});expect(readEventCoverage(db,now+1).gaps[0].dropped).toBe(2);
    flushEventCoverage(db,now+1);expect(readEventCoverage(db,now+1).pending).toBe(false);expect(readEventCoverage(db,now+1).gaps[0].dropped).toBe(2);
  });
  it('limite aussi la mention de sauvegarde en attente à la période affichée', () => {
    queueEvent(db,{...event,name:'x'.repeat(9000)},now);flushEventCoverage(db,now);
    queueEvent(db,{...event,name:'x'.repeat(9000)},now-8*86400000);
    const a=readCrmAudience(db,crmPeriod(7,now));expect(a.collection.pending).toBe(false);expect(a.collection.gaps).toHaveLength(1);
  });
  it.each(['2026-03-28T23:30:00Z','2026-03-29T21:30:00Z','2026-10-24T22:30:00Z','2026-10-25T22:30:00Z'])('conserve une preuve cohérente au changement d’heure (%s)', iso => {
    const t=Date.parse(iso);queueEvent(db,{...event,name:'x'.repeat(9000)},t);flushEventCoverage(db,t);
    expect(readEventCoverage(db,t)).toMatchObject({available:true,pending:false});expect(readEventCoverage(db,t).gaps[0].day).toBe(swissDay(t));
  });
  it('fusionne les preuves entre connexions et les retrouve après réouverture', () => {
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now); flushEventCoverage(db, now);
    const second = new Database(db.name); queueEvent(second, { ...event, name: 'x'.repeat(9000) }, now + 1); flushEventCoverage(second, now + 1); second.close();
    const path = db.name; db.close(); db = new Database(path);
    expect(readEventCoverage(db, now + 1).gaps[0]).toMatchObject({ dropped: 2, reasons: { size: 2 }, first_at: now, last_at: now + 1 });
  });
  it('purge les anciennes preuves à la lecture et lors de la fusion, sans toucher aux événements', () => {
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now - EVENT_RETENTION_MS - 86_400_000); flushEventCoverage(db, now - EVENT_RETENTION_MS - 86_400_000);
    expect(readEventCoverage(db, now).gaps).toEqual([]);
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now); flushEventCoverage(db, now);
    expect(readEventCoverage(db, now).gaps).toHaveLength(1);
  });
  it.each(['json', 'horodatage', 'jour', 'compte', 'doublon'])('signale une preuve %s invalide et conserve l’incertitude après reprise', mode => {
    const gap = { day: swissDay(now), dropped: 1, first_at: now, last_at: now, reasons: { size: 1 } };
    const proof = { version: 1, checked_at: now, uncertain_before: null, gaps: [gap] };
    if (mode === 'horodatage') proof.checked_at--;
    if (mode === 'jour') gap.day = '2026-09-25';
    if (mode === 'compte') gap.dropped++;
    if (mode === 'doublon') proof.gaps.push(gap);
    db.prepare('INSERT INTO operation_checks VALUES(?,?,?)').run('event_collection', now, mode === 'json' ? '{illisible' : JSON.stringify(proof));
    expect(readEventCoverage(db, now).available).toBe(false);
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now); flushEventCoverage(db, now);
    expect(readEventCoverage(db, now)).toMatchObject({ available: true, uncertain_before: now });
    expect(readEventCoverage(db, now + EVENT_RETENTION_MS + 1).uncertain_before).toBeNull();
  });
  it('reprend une preuve en échec après une minute, sans boucle à chaque abandon', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); db.exec('DROP TABLE operation_checks');
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    for (let i = 0; i < 1000; i++) queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now);
    await vi.advanceTimersByTimeAsync(59_999); expect(readEventCoverage(db, now).pending).toBe(true); expect(vi.getTimerCount()).toBe(1);
    db.exec('CREATE TABLE operation_checks(name TEXT PRIMARY KEY,checked_at INTEGER,details_json TEXT)');
    await vi.advanceTimersByTimeAsync(1); expect(readEventCoverage(db, now)).toMatchObject({ available: true, pending: false });
    expect(readEventCoverage(db, now).gaps[0].dropped).toBe(1001); expect(vi.getTimerCount()).toBe(0);
  });
  it('réserve le premier témoin immédiat au premier abandon, puis borne les sauvegardes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now); await vi.advanceTimersByTimeAsync(0);
    expect(readEventCoverage(db, now).pending).toBe(false);
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now); await vi.advanceTimersByTimeAsync(59_999);
    expect(readEventCoverage(db, now).pending).toBe(true); await vi.advanceTimersByTimeAsync(1);
    expect(readEventCoverage(db, now).pending).toBe(false); expect(readEventCoverage(db, now).gaps[0].dropped).toBe(2);
  });
  it('annote une journée sans aucune page et ne la transforme pas en zéro mesuré', () => {
    queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now);
    const a = readCrmAudience(db, crmPeriod(7, now));
    expect(a.daily.at(-1)).toMatchObject({ views: null, visitors: null, incomplete: true }); expect(a.collection.gaps).toHaveLength(1);
    const html = renderCollectionStatus(a.collection); expect(html).toContain('Au moins 1 événement'); expect(html).toContain('attend encore sa sauvegarde');
    expect(html).not.toContain('visiteur perdu');
  });
  it('restreint les preuves à la période et garde les totaux des seules traces enregistrées', async () => {
    queueEvent(db, event, now); queueEvent(db, { ...event, name: 'x'.repeat(9000) }, now - 8 * 86_400_000); await tick();
    const a = readCrmAudience(db, crmPeriod(7, now)); expect(a.web.pageviews).toBe(1); expect(a.collection.gaps).toEqual([]);
    expect(renderCollectionStatus(a.collection)).toBe(''); expect(a.daily.at(-1)?.incomplete).toBe(false);
  });
  it('ne présente pas une preuve illisible comme un bilan sain', () => {
    db.exec('DROP TABLE operation_checks'); const html = renderCollectionStatus(readEventCoverage(db, now));
    expect(html).toContain('Historique de collecte à vérifier'); expect(html).toContain('ne peut pas être vérifiée'); expect(html).not.toContain('Au moins 0');
  });
});
