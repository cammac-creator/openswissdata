import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../../src/index.js';
import { getDb, closeDb, SQLITE_BUSY_TIMEOUT_MS } from '../../src/lib/db.js';
import { insertClient, insertToken, insertAuthCode, consumeAuthCode } from '../../src/mcp/oauth/store.js';
import { hashToken, pkceChallengeS256 } from '../../src/mcp/oauth/crypto.js';
import { TIER_DEFAULT_SCOPES } from '../../src/mcp/oauth/scopes.js';

const CLIENT='osd_atomicite_fictive',SECRET='secret-fictif',CODE='C'.repeat(43),VERIFIER='V'.repeat(43),REFRESH='R'.repeat(43),ACCESS='A'.repeat(43),REDIRECT='https://client.example.test/callback';
describe('Emission OAuth indivisible sur base fictive',()=>{
 let folder:string, app:ReturnType<typeof createApp>;
 beforeEach(()=>{
  closeDb();folder=mkdtempSync(join(tmpdir(),'osd-atomicite-'));vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));vi.stubEnv('OAUTH_SIGNING_SECRET','cle-fictive-pour-transactions-oauth');vi.stubEnv('MCP_BEARER_TOKEN','');
  insertClient({redirect_uris:[REDIRECT],client_id:CLIENT,client_secret_hash:hashToken(SECRET),name:'Exemple',email:'demo@example.test',tier:'pro',scopes:TIER_DEFAULT_SCOPES.pro});
  insertAuthCode({code:hashToken(CODE),client_id:CLIENT,redirect_uri:REDIRECT,code_challenge:pkceChallengeS256(VERIFIER),code_challenge_method:'S256',scope:'finma:read',state:null});
  insertToken({client_id:CLIENT,access_token_plain:ACCESS,refresh_token_plain:REFRESH,scope:'finma:read'});
  app=createApp();
 });
 afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(folder,{recursive:true,force:true})});
 const exchange=(kind='authorization_code',extra:Record<string,string>={})=>app.request('/mcp/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:kind,client_id:CLIENT,client_secret:SECRET,code:CODE,code_verifier:VERIFIER,redirect_uri:REDIRECT,refresh_token:REFRESH,...extra})});
 const codeRow=()=>getDb().prepare('SELECT used_at FROM mcp_oauth_codes WHERE code=?').get(hashToken(CODE)) as {used_at:number|null};
 const active=()=>getDb().prepare('SELECT COUNT(*) n FROM mcp_tokens WHERE revoked_at IS NULL').get();
 it.each([{code_verifier:'X'.repeat(43)},{redirect_uri:'https://autre.example.test/callback'},{client_secret:'mauvais-secret'}])('une erreur de preuve ne consomme pas le code %j',async extra=>{
  expect((await exchange('authorization_code',extra)).status).toBeGreaterThanOrEqual(400);expect(codeRow().used_at).toBeNull();expect((await exchange()).status).toBe(200);
 });
 it('un autre client authentifié ne peut ni utiliser ni brûler le code',async()=>{
  insertClient({client_id:'osd_autre',client_secret_hash:hashToken(SECRET),name:'Autre',email:'autre@example.test',tier:'free',scopes:TIER_DEFAULT_SCOPES.free});
  expect((await exchange('authorization_code',{client_id:'osd_autre'})).status).toBe(400);expect(codeRow().used_at).toBeNull();expect((await exchange()).status).toBe(200);
 });
 it('un code ne crée qu’une paire de jetons',async()=>{
  expect((await exchange()).status).toBe(200);const used=codeRow().used_at;expect(used).not.toBeNull();expect((await exchange()).status).toBe(400);expect(codeRow().used_at).toBe(used);expect(active()).toEqual({n:2});
 });
 it('la primitive de consommation refuse un code déjà utilisé',()=>{expect(consumeAuthCode(CODE)).not.toBeNull();expect(consumeAuthCode(CODE)).toBeNull()});
 it('un marqueur utilisé égal à zéro reste un code consommé',async()=>{getDb().exec('UPDATE mcp_oauth_codes SET used_at=0');expect((await exchange()).status).toBe(400);expect(active()).toEqual({n:1})});
 it('la portée du code est bornée aux droits encore autorisés lors de l’émission',async()=>{
  getDb().exec("UPDATE mcp_oauth_codes SET scope='finma:read tariff:semantic'; UPDATE mcp_clients SET scopes='finma:read'");
  const response=await exchange();expect(response.status).toBe(200);expect((await response.json()).scope).toBe('finma:read');
 });
 it('le code sans droit restant est refusé sans consommation',async()=>{getDb().exec("UPDATE mcp_clients SET scopes='tariff:read'");expect((await exchange()).status).toBe(400);expect(codeRow().used_at).toBeNull();expect(active()).toEqual({n:1})});
 it.each(['authorization_code','refresh_token'])('un compte révoqué ne consomme aucun artefact %s',async kind=>{
  getDb().prepare('UPDATE mcp_clients SET revoked_at=?').run(Date.now());expect((await exchange(kind)).status).toBe(401);expect(codeRow().used_at).toBeNull();expect(active()).toEqual({n:1});
 });
 it.each([null,0])('refuse une expiration de refresh absente ou nulle : %s',async value=>{getDb().prepare('UPDATE mcp_tokens SET refresh_expires_at=?').run(value);expect((await exchange('refresh_token')).status).toBe(400);expect(active()).toEqual({n:1})});
 it.each(['authorization_code','refresh_token'])('refuse le seuil exact d’expiration %s',async kind=>{
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
  getDb().prepare('UPDATE mcp_oauth_codes SET expires_at=?').run(now);getDb().prepare('UPDATE mcp_tokens SET refresh_expires_at=?').run(now);
  expect((await exchange(kind)).status).toBe(400);expect(codeRow().used_at).toBeNull();expect(active()).toEqual({n:1});
 });
 it('le jeton d’accès est aussi expiré au seuil exact',async()=>{
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);getDb().prepare('UPDATE mcp_tokens SET expires_at=?').run(now);
  const r=await app.request('/mcp/jsonrpc',{method:'POST',headers:{authorization:'Bearer '+ACCESS,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});expect(r.status).toBe(401);
 });
 it.each([['authorization_code','ABORT'],['refresh_token','ABORT'],['authorization_code','ROLLBACK'],['refresh_token','ROLLBACK']])('rollback si insertion impossible %s / %s',async (kind,mode)=>{
  getDb().exec(`CREATE TRIGGER panne_fictive BEFORE INSERT ON mcp_tokens BEGIN SELECT RAISE(${mode},'detail-prive-fictif'); END`);
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});const response=await exchange(kind);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'temporarily_unavailable'});expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('retry-after')).toBe('1');
  expect(codeRow().used_at).toBeNull();expect(active()).toEqual({n:1});expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_tokens').get()).toEqual({n:1});expect(getDb().inTransaction).toBe(false);expect(getDb().pragma('busy_timeout',{simple:true})).toBe(5000);expect(JSON.stringify(warn.mock.calls)).not.toContain('detail-prive');
  getDb().exec('DROP TRIGGER panne_fictive');expect((await exchange(kind)).status).toBe(200);
 });
 it('un verrou concurrent rend un refus rapide sans consommer puis permet la reprise',async()=>{
  const db=getDb(),timeout=db.pragma('busy_timeout',{simple:true});const other=new Database(join(folder,'fictive.sqlite'));other.exec('BEGIN IMMEDIATE');
  try {const start=performance.now();const response=await exchange('refresh_token');expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'temporarily_unavailable'});expect(performance.now()-start).toBeLessThan(500);expect(db.pragma('busy_timeout',{simple:true})).toBe(timeout);expect(active()).toEqual({n:1})}finally{other.exec('ROLLBACK');other.close()}
  expect((await exchange('refresh_token')).status).toBe(200);
 });
 it('rotation unique : ancien accès et refresh refusés, nouveau jeton utilisable',async()=>{
  const response=await exchange('refresh_token');expect(response.status).toBe(200);const issued=await response.json();expect(issued.scope).toBe('finma:read');expect((await exchange('refresh_token')).status).toBe(400);expect(active()).toEqual({n:1});
  const call=(token:string)=>app.request('/mcp/jsonrpc',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  expect((await call(ACCESS)).status).toBe(401);expect((await call(issued.access_token)).status).toBe(200);
  expect(getDb().pragma('busy_timeout',{simple:true})).toBe(5000);
 });
 it('une panne de réglage après commit ne masque pas les jetons déjà émis',async()=>{
  const db=getDb(),original=db.pragma.bind(db);let injected=0;
  const spy=vi.spyOn(db,'pragma').mockImplementation(((statement:string,options?:unknown)=>{if(statement===`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`&&!injected){injected++;throw new Error('panne-fictive-restauration')}return original(statement,options as any)}) as any);
  try {
   const r=await exchange('refresh_token');expect(r.status).toBe(200);const issued=await r.json();expect(issued.access_token).toBeTruthy();expect(active()).toEqual({n:1});expect(injected).toBe(1);
   const next=await exchange('refresh_token',{refresh_token:issued.refresh_token});expect(next.status).toBe(200);expect(db.pragma('busy_timeout',{simple:true})).toBe(SQLITE_BUSY_TIMEOUT_MS);
  }finally{spy.mockRestore();db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)}
 });
 it('un corps multipart malformé conserve les en-têtes sans cache',async()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});
  const r=await app.request('/mcp/oauth/token',{method:'POST',headers:{'content-type':'multipart/form-data'},body:'fictif'});expect(r.status).toBeGreaterThanOrEqual(400);expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('pragma')).toBe('no-cache');expect(codeRow().used_at).toBeNull();expect(active()).toEqual({n:1});
 });
 it.each(['authorization_code','refresh_token','inconnu'])('aucune réponse de jeton ne se met en cache %s',async kind=>{
  const r=await exchange(kind);expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('pragma')).toBe('no-cache');
 });
});
