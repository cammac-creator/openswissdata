import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { consumeCheckoutLimit, CHECKOUT_GAP_MS, CheckoutLimitError, reportCheckoutLimitFailure } from '../../src/lib/checkout-limits.js';
import { consumeAuthLimit } from '../../src/lib/auth-limits.js';
import { runCleanup, runFullCleanup, readCleanupProof } from '../../src/lib/cleanup.js';

const NOW=Date.UTC(2026,8,26,12);
describe('Protection durable des demandes Checkout',()=>{
  let dir:string,db:Database.Database;
  beforeEach(()=>{
    closeDb();dir=mkdtempSync(join(tmpdir(),'osd-checkout-limites-'));vi.stubEnv('DATABASE_PATH',join(dir,'fictive.sqlite'));
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('RAILWAY_ENVIRONMENT_ID','');vi.stubEnv('SESSION_SECRET','cle-fictive-assez-longue-limitation');db=getDb();
  });
  afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true})});
  const count=()=>db.prepare('SELECT COUNT(*) n FROM checkout_request_limits').get();
  it('conserve le délai sur une seconde connexion puis après redémarrage, même en mode test',()=>{
    expect(consumeCheckoutLimit(db,'192.0.2.1',NOW)).toEqual({allowed:true});
    const other=new Database(db.name);try{expect(consumeCheckoutLimit(other,'192.0.2.1',NOW+1)).toEqual({allowed:false,retryAfter:6})}finally{other.close()}
    closeDb();db=getDb();expect(consumeCheckoutLimit(db,'192.0.2.1',NOW+5999)).toEqual({allowed:false,retryAfter:1});
    expect(consumeCheckoutLimit(db,'192.0.2.1',NOW+6000)).toEqual({allowed:true});expect(count()).toEqual({n:1});
  });
  it('ne prolonge pas le compteur pendant des refus répétés',()=>{
    consumeCheckoutLimit(db,'192.0.2.1',NOW);const row=db.prepare('SELECT * FROM checkout_request_limits').get();
    for(let i=1;i<6;i++)expect(consumeCheckoutLimit(db,'192.0.2.1',NOW+i*1000)).toEqual({allowed:false,retryAfter:6-i});
    expect(db.prepare('SELECT * FROM checkout_request_limits').get()).toEqual(row);
    expect(consumeCheckoutLimit(db,'192.0.2.1',NOW+6000)).toEqual({allowed:true});
  });
  it('ne conserve aucune adresse brute et sépare les clés de celles de connexion',()=>{
    consumeCheckoutLimit(db,'192.0.2.25',NOW);consumeAuthLimit(db,'ip','192.0.2.25',NOW);
    const rows=db.prepare('SELECT * FROM checkout_request_limits').all() as {identity_key:string}[];
    expect(rows).toHaveLength(1);expect(rows[0].identity_key).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(rows)).not.toContain('192.0.2.25');
    expect(db.prepare('SELECT identity_key FROM auth_request_limits').get()).not.toEqual({identity_key:rows[0].identity_key});
  });
  it.each([NaN,Infinity,100,1.5,8_640_000_000_000_000,Number.MAX_SAFE_INTEGER])('refuse une horloge invalide (%s) avant toute écriture',now=>{
    expect(()=>consumeCheckoutLimit(db,'192.0.2.1',now)).toThrow(CheckoutLimitError);expect(count()).toEqual({n:0});
  });
  it('refuse un recul d’horloge sans effacer le compteur',()=>{
    consumeCheckoutLimit(db,'192.0.2.1',NOW);expect(()=>consumeCheckoutLimit(db,'192.0.2.1',NOW-1)).toThrow(CheckoutLimitError);
    expect(consumeCheckoutLimit(db,'192.0.2.1',NOW)).toEqual({allowed:false,retryAfter:6});
  });
  it.each(['texte',Math.floor(NOW/1000),NOW+CHECKOUT_GAP_MS+1])('conserve pour examen un compteur incohérent (%s)',expiry=>{
    consumeCheckoutLimit(db,'192.0.2.1',NOW);db.pragma('ignore_check_constraints=ON');db.prepare('UPDATE checkout_request_limits SET expires_at=?').run(expiry);
    expect(()=>consumeCheckoutLimit(db,'192.0.2.1',NOW+10_000)).toThrow(CheckoutLimitError);expect(count()).toEqual({n:1});
  });
  it('plafonne le nombre de lignes sans évincer les protections actives',()=>{
    consumeCheckoutLimit(db,'192.0.2.1',NOW);
    const insert=db.prepare('INSERT INTO checkout_request_limits VALUES(?,?,?)');
    db.transaction(()=>{for(let i=0;i<9999;i++)insert.run(i.toString(16).padStart(64,'0'),NOW,NOW+6000)})();
    expect(()=>consumeCheckoutLimit(db,'192.0.2.2',NOW)).toThrow(CheckoutLimitError);expect(count()).toEqual({n:10000});
    expect(consumeCheckoutLimit(db,'192.0.2.1',NOW+1)).toEqual({allowed:false,retryAfter:6});
    expect(consumeCheckoutLimit(db,'192.0.2.2',NOW+6000)).toEqual({allowed:true});expect(count()).toEqual({n:9501});
    expect(runCleanup(db,NOW+6000).entries.find(x=>x.name==='checkout_request_limits')).toMatchObject({status:'ok',deleted:9500});expect(count()).toEqual({n:1});
  });
  it('ne bloque pas cinq secondes sur un verrou et restitue le délai SQLite après échec',()=>{
    const other=new Database(db.name);other.exec('BEGIN IMMEDIATE');const before=performance.now();
    try{expect(()=>consumeCheckoutLimit(db,'192.0.2.1',NOW)).toThrow();expect(performance.now()-before).toBeLessThan(1000);expect(db.pragma('busy_timeout',{simple:true})).toBe(5000);expect(count()).toEqual({n:0})}
    finally{other.exec('ROLLBACK');other.close()}
    expect(consumeCheckoutLimit(db,'192.0.2.1',NOW)).toEqual({allowed:true});expect(db.pragma('busy_timeout',{simple:true})).toBe(5000);
  });
  it('annule toute la transaction lorsque l’écriture est refusée',()=>{
    consumeCheckoutLimit(db,'192.0.2.1',NOW);db.exec("CREATE TRIGGER stop_checkout BEFORE INSERT ON checkout_request_limits BEGIN SELECT RAISE(ABORT,'erreur fictive privée'); END");
    expect(()=>consumeCheckoutLimit(db,'192.0.2.2',NOW+6000)).toThrow();expect(count()).toEqual({n:1});expect(db.pragma('busy_timeout',{simple:true})).toBe(5000);
  });
  it.each([['production',''],['development','fictif'],['test','fictif']])('refuse une clé absente en %s avec Railway=%s',(env,railway)=>{
    vi.stubEnv('NODE_ENV',env);vi.stubEnv('RAILWAY_ENVIRONMENT_ID',railway);vi.stubEnv('SESSION_SECRET','');
    expect(()=>consumeCheckoutLimit(db,'192.0.2.1',NOW)).toThrow(CheckoutLimitError);expect(count()).toEqual({n:0});
  });
  it('retire seulement les compteurs expirés et invalide un témoin antérieur sans cette catégorie',async()=>{
    consumeCheckoutLimit(db,'192.0.2.1',NOW);consumeCheckoutLimit(db,'192.0.2.2',NOW+1);
    const proof=await runFullCleanup(db,NOW+6000);expect(proof.ok).toBe(true);expect(proof.entries).toHaveLength(18);
    expect(proof.entries.find(x=>x.name==='checkout_request_limits')).toMatchObject({status:'ok',deleted:1});expect(count()).toEqual({n:1});expect(readCleanupProof(db)).toEqual(proof);
    const old={...proof,entries:proof.entries.filter(x=>x.name!=='checkout_request_limits'),totalDeleted:proof.totalDeleted-1};
    db.prepare("UPDATE operation_checks SET details_json=? WHERE name='cleanup'").run(JSON.stringify(old));expect(readCleanupProof(db)).toBeNull();
  });
  it('signale une table de limitation absente au nettoyage',()=>{
    db.exec('DROP TABLE checkout_request_limits');expect(runCleanup(db,NOW).entries.find(x=>x.name==='checkout_request_limits')).toMatchObject({status:'error',error:'database_error'});
  });
  it('journalise une cause fermée et supporte une panne du journal',()=>{
    vi.spyOn(Date,'now').mockReturnValue(NOW);const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
    reportCheckoutLimitFailure(new Error('192.0.2.3 secret exemple'));expect(log).toHaveBeenCalledWith('[paiement] protection temporairement indisponible : storage');
    reportCheckoutLimitFailure(new CheckoutLimitError('capacity'));expect(log).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue(NOW+60_000);log.mockImplementation(()=>{throw new Error('journal fictif')});expect(()=>reportCheckoutLimitFailure(new CheckoutLimitError('clock'))).not.toThrow();expect(log).toHaveBeenCalledTimes(2);
  });
});
