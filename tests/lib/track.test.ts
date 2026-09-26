import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { track, trackPageView, uaClassFromRequest, countryFromRequest, refererOrigin } from '../../src/lib/track.js';

describe('Origine des mesures et agents présumés', () => {
  let temp: string;
  beforeEach(() => { temp = mkdtempSync(join(tmpdir(), 'osd-track-')); vi.stubEnv('DATABASE_PATH', join(temp, 'test.sqlite')); });
  afterEach(async () => { await new Promise(r => setImmediate(r)); closeDb(); rmSync(temp, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const ua = async (value: string) => {
    const app = new Hono(); app.get('/', c => c.text(uaClassFromRequest(c)));
    return (await app.request('/', { headers: { 'user-agent': value } })).text();
  };
  it.each([
    ['', 'other'], ['Agent inconnu/1.0', 'other'], ['Mozilla/5.0 (compatible; outil-inconnu)', 'other'],
    ['Android application/2.0', 'other'], ['curl/8.0', 'automation'], ['Dalvik/2.1.0 (Linux; Android)', 'automation'],
    ['Mozilla/5.0 Chrome/120.0 HeadlessChrome/120.0', 'automation'], ['Mozilla/5.0 Chrome/120.0 Googlebot/2.1', 'bot'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', 'desktop'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'desktop'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'mobile'],
    ['Mozilla/5.0 (Android 15; Mobile) Gecko/20100101 Firefox/130.0', 'mobile'],
    ['Mozilla/5.0 Gecko/20100101 Firefox/130.0', 'desktop'], ['Mozilla/5.0 Chrome/130.0 ' + 'x'.repeat(1100), 'other'],
  ])('classe %s en %s sans assimiler tout inconnu à un humain', async (value, expected) => { expect(await ua(value)).toBe(expected); });
  it('conserve les traces anciennes comme historiques lors de la migration', () => {
    const old = new Database(process.env.DATABASE_PATH!);
    old.exec("CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,name TEXT,status INTEGER,duration_ms INTEGER,customer_id INTEGER,visitor_hash TEXT,country TEXT,referer TEXT,ua_class TEXT,meta_json TEXT,ts INTEGER NOT NULL);INSERT INTO events(kind,name,ua_class,ts) VALUES('custom','page_view','desktop',1790400000000)"); old.close();
    expect(getDb().prepare('SELECT origin,ua_class FROM events').get()).toEqual({ origin: 'legacy', ua_class: 'desktop' });
    closeDb(); expect(getDb().prepare('SELECT COUNT(*) n FROM events').get()).toEqual({ n: 1 });
  });
  it('attribue une origine interne et capture la date avant la file asynchrone', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1790400000000);
    track({ kind: 'custom', origin: 'server', name: 'mesure_fictive' }); clock.mockReturnValue(1790400005000);
    await new Promise(r => setImmediate(r));
    expect(getDb().prepare('SELECT origin,ts FROM events').get()).toEqual({ origin: 'server', ts: 1790400000000 });
  });
  it('mesure une vraie réponse HTML, sans stocker sa requête sensible ni confondre le bureau', async () => {
    const app = new Hono(); app.use('*', trackPageView); app.get('*', c => c.html('<html><body>Fictif</body></html>'));
    await app.request('/exemple?email=prive@example.test', { headers: { 'user-agent': 'Mozilla/5.0 Chrome/130.0' } });
    await app.request('/admin'); await app.request('/de/account'); await new Promise(r => setImmediate(r));
    const rows = getDb().prepare('SELECT origin,name,meta_json FROM events').all();
    expect(rows).toEqual([{ origin: 'server', name: 'page_view', meta_json: '{"path":"/exemple"}' }]);
    expect(JSON.stringify(rows)).not.toContain('prive@example');
  });
  it('borne les erreurs de stockage sans afficher le contenu brut', async () => {
    const db = getDb(); db.exec('DROP TABLE events'); const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Date, 'now').mockReturnValue(1790400000000);
    for (let i = 0; i < 3; i++) track({ kind: 'custom', origin: 'server', name: 'prive@example.test' });
    await new Promise(r => setImmediate(r)); expect(log).toHaveBeenCalledTimes(1); expect(log).toHaveBeenCalledWith('[mesures] enregistrement momentanément indisponible');
  });
  it('borne les en-têtes conservés et retire paramètres et identifiants du référent', async () => {
    const app = new Hono(); app.get('/', c => c.json({country:countryFromRequest(c),referer:refererOrigin(c)}));
    for (const [country,referer] of [['<img src=x onerror=alert(1)>','https://'+ 'x'.repeat(300)+'.test/a'],['CH'.repeat(4000),'https://example.test/'+ 'x'.repeat(8000)],['ZZZ','data:text/plain,prive']]) {
      const r = await app.request('/',{headers:{'cf-ipcountry':country,referer}});expect(await r.json()).toEqual({country:null,referer:null});
    }
    expect(await(await app.request('/',{headers:{'cf-ipcountry':'ch',referer:'https://user:pass@example.test/private?token=secret'}})).json()).toEqual({country:'CH',referer:'https://example.test'});
  });

});
