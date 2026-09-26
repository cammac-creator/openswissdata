import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getDb, closeDb } from '../../src/lib/db.js';
import { authRequestIp, consumeAuthLimit, normalizeAuthIp, reportAuthLimitFailure, AuthLimitError, AUTH_EMAIL_REFILL_MS } from '../../src/lib/auth-limits.js';
import { runCleanup } from '../../src/lib/cleanup.js';

describe('Protection durable des demandes de connexion', () => {
  let folder:string,db:Database.Database;
  const now=1_790_415_000_000;
  beforeEach(()=>{
    closeDb();folder=mkdtempSync(join(tmpdir(),'osd-limites-'));
    vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));
    vi.stubEnv('SESSION_SECRET','cle-fictive-stable-de-limitation');
    vi.stubEnv('NODE_ENV','test');db=getDb();
  });
  afterEach(()=>{closeDb();vi.unstubAllEnvs();rmSync(folder,{recursive:true,force:true})});
  it('partage la limite avec une seconde connexion et conserve le délai après redémarrage',()=>{
    expect(consumeAuthLimit(db,'ip','192.0.2.1',now)).toBe(true);
    const second=new Database(db.name);try{expect(consumeAuthLimit(second,'ip','192.0.2.1',now+1)).toBe(false)}finally{second.close()}
    closeDb();db=getDb();expect(consumeAuthLimit(db,'ip','192.0.2.1',now+9999)).toBe(false);
    expect(consumeAuthLimit(db,'ip','192.0.2.1',now+10000)).toBe(true);
  });
  it('limite les envois cumulés malgré une minute entre chaque demande',()=>{
    for(let i=0;i<5;i++)expect(consumeAuthLimit(db,'email','cible@example.test',now+i*60000)).toBe(true);
    expect(consumeAuthLimit(db,'email','cible@example.test',now+5*60000)).toBe(false);
    expect(consumeAuthLimit(db,'email','cible@example.test',now+12*60000)).toBe(true);
  });
  it('les refus ne repoussent ni le réapprovisionnement ni la suppression',()=>{
    expect(consumeAuthLimit(db,'email','cible@example.test',now)).toBe(true);
    const before=db.prepare('SELECT * FROM auth_request_limits').get();
    for(let i=1;i<60;i++)expect(consumeAuthLimit(db,'email','cible@example.test',now+i*1000)).toBe(false);
    expect(db.prepare('SELECT * FROM auth_request_limits').get()).toEqual(before);
    expect(consumeAuthLimit(db,'email','cible@example.test',now+60000)).toBe(true);
  });
  it('ne stocke ni email ni IP en clair et sépare les deux dimensions',()=>{
    expect(consumeAuthLimit(db,'email','Cible@example.test',now)).toBe(true);
    expect(consumeAuthLimit(db,'email','cible@example.test',now)).toBe(false);
    expect(consumeAuthLimit(db,'ip','192.0.2.25',now)).toBe(true);
    const rows=db.prepare('SELECT * FROM auth_request_limits').all() as Array<{identity_key:string}>;
    expect(rows).toHaveLength(2);expect(rows.every(r=>/^[a-f0-9]{64}$/.test(r.identity_key))).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/example|192\.0\.2\.25/);
  });
  it('ne réinitialise pas un compteur lors d’un retour arrière de l’horloge',()=>{
    expect(consumeAuthLimit(db,'ip','192.0.2.26',now)).toBe(true);
    expect(consumeAuthLimit(db,'ip','192.0.2.26',now-10000)).toBe(false);
  });
  it('retire les compteurs expirés lors du nettoyage périodique et garde ceux encore utiles',()=>{
    consumeAuthLimit(db,'email','ancien@example.test',now);
    consumeAuthLimit(db,'email','recent@example.test',now+60000);
    const result=runCleanup(db,now+AUTH_EMAIL_REFILL_MS);
    expect(result.entries.find(x=>x.name==='auth_request_limits')).toMatchObject({deleted:1,status:'ok'});
    expect((db.prepare('SELECT COUNT(*) AS n FROM auth_request_limits').get() as {n:number}).n).toBe(1);
  });
  it('récupère les lignes expirées même avant le prochain passage périodique',()=>{
    consumeAuthLimit(db,'email','ancien@example.test',now);
    consumeAuthLimit(db,'email','nouveau@example.test',now+AUTH_EMAIL_REFILL_MS);
    expect((db.prepare('SELECT COUNT(*) AS n FROM auth_request_limits').get() as {n:number}).n).toBe(1);
  });
  it('borne le stockage sans évincer une protection active, puis récupère la place expirée',()=>{
    const insert=db.prepare('INSERT INTO auth_request_limits(scope,identity_key,budget_ms,updated_at,accepted_at,expires_at) VALUES(?,?,?,?,?,?)');
    db.transaction(()=>{for(let i=0;i<200000;i++)insert.run('email',i.toString(16).padStart(64,'0'),0,now,now,now+AUTH_EMAIL_REFILL_MS)})();
    expect(()=>consumeAuthLimit(db,'email','nouveau@example.test',now)).toThrow('auth_limit_unavailable');
    expect(consumeAuthLimit(db,'ip','192.0.2.99',now)).toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM auth_request_limits').get() as {n:number}).n).toBe(200001);
    expect(consumeAuthLimit(db,'email','nouveau@example.test',now+AUTH_EMAIL_REFILL_MS)).toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM auth_request_limits').get() as {n:number}).n).toBe(199502);
    runCleanup(db,now+AUTH_EMAIL_REFILL_MS);
    expect((db.prepare('SELECT COUNT(*) AS n FROM auth_request_limits').get() as {n:number}).n).toBe(1);
  });
  it('ne désactive jamais la protection quand la clé manque en production',()=>{
    vi.stubEnv('NODE_ENV','production');vi.stubEnv('SESSION_SECRET','');
    expect(()=>consumeAuthLimit(db,'email','cible@example.test',now)).toThrow('auth_limit_unavailable');
  });
  it('ferme aussi une préproduction Railway dépourvue de clé',()=>{
    vi.stubEnv('NODE_ENV','development');vi.stubEnv('RAILWAY_ENVIRONMENT_ID','fictif');vi.stubEnv('SESSION_SECRET','');
    expect(()=>consumeAuthLimit(db,'email','cible@example.test',now)).toThrow('auth_limit_unavailable');
  });
  it('agrège les IPv6 équivalentes et le préfixe /64, avec normalisation des IPv4 mappées',()=>{
    expect(normalizeAuthIp('2001:0DB8:0001:0002:0000:0000:0000:0001')).toBe(normalizeAuthIp('2001:db8:1:2::ffff'));
    expect(normalizeAuthIp('2001:db8:1:3::1')).not.toBe(normalizeAuthIp('2001:db8:1:2::1'));
    expect(normalizeAuthIp('::ffff:192.0.2.10')).toBe('192.0.2.10');
    expect(normalizeAuthIp('::ffff:c000:20a')).toBe('192.0.2.10');
    expect(normalizeAuthIp('fe80::1%eth0')).toBe('unknown');
    expect(consumeAuthLimit(db,'ip',normalizeAuthIp('2001:db8:1:2::1'),now)).toBe(true);
    expect(consumeAuthLimit(db,'ip',normalizeAuthIp('2001:db8:1:2::2'),now)).toBe(false);
  });
  it('utilise WAL et un délai de verrou adapté sur la base du service',()=>{
    expect(db.pragma('journal_mode',{simple:true})).toBe('wal');
    expect(db.pragma('busy_timeout',{simple:true})).toBeGreaterThanOrEqual(5000);
  });
  it('journalise une cause connue sans contenu brut et sans répétition rapprochée',()=>{
    const spy=vi.spyOn(console,'warn').mockImplementation(()=>{});
    try {
      reportAuthLimitFailure(new AuthLimitError('capacity_email'));
      reportAuthLimitFailure(new Error('adresse-fictive@example.test et détail technique'));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe('[connexion] protection temporairement indisponible : capacity_email');
    } finally { spy.mockRestore(); }
  });
  it('fait confiance uniquement au champ Railway attendu et à une IP valide',async()=>{
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID','fictif');const app=new Hono();app.get('/',c=>c.text(authRequestIp(c)));
    expect(await (await app.request('/',{headers:{'x-real-ip':'192.0.2.10','x-forwarded-for':'198.51.100.1'}})).text()).toBe('192.0.2.10');
    expect(await (await app.request('/',{headers:{'x-real-ip':'192.0.2.10,198.51.100.1'}})).text()).toBe('unknown');
    expect(await (await app.request('/',{headers:{'x-forwarded-for':'192.0.2.10'}})).text()).toBe('unknown');
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID','');
    expect(await (await app.request('/',{headers:{'x-real-ip':'192.0.2.10'}})).text()).toBe('unknown');
  });
});
