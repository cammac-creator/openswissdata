import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../src/index.js';
import {getDb,closeDb} from '../../src/lib/db.js';
import * as store from '../../src/mcp/oauth/store.js';
import * as quota from '../../src/mcp/oauth/quota.js';
import {hashToken} from '../../src/mcp/oauth/crypto.js';
import {isToolAllowed} from '../../src/mcp/oauth/verify.js';
import {TIER_DEFAULT_SCOPES,SCOPES} from '../../src/mcp/oauth/scopes.js';
import {_resetRateLimit} from '../../src/mcp/rate-limit.js';
import {kycCheckTool} from '../../src/mcp/tools/kyc-check.js';
import {tariffSemanticSearchTool} from '../../src/mcp/tools/tariff-semantic-search.js';
const SECRET='secret-fictif-frontieres',ACCESS='A'.repeat(43),REFRESH='R'.repeat(43),ADMIN='M'.repeat(43);
describe('Frontières des accès MCP sur comptes fictifs',()=>{
 let folder:string,app:ReturnType<typeof createApp>;
 beforeEach(()=>{closeDb();_resetRateLimit();folder=mkdtempSync(join(tmpdir(),'osd-frontieres-'));vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));vi.stubEnv('OAUTH_SIGNING_SECRET','cle-fictive-frontieres-oauth');vi.stubEnv('MCP_BEARER_TOKEN',ADMIN);
  for(const id of ['osd_A','osd_B'])store.insertClient({client_id:id,client_secret_hash:hashToken(SECRET),name:'Compte fictif',email:'demo@example.test',tier:'pro',scopes:TIER_DEFAULT_SCOPES.pro});
  store.insertToken({client_id:'osd_B',access_token_plain:ACCESS,refresh_token_plain:REFRESH,scope:'finma:read'});app=createApp();
 });
 afterEach(()=>{vi.restoreAllMocks();closeDb();_resetRateLimit();vi.unstubAllEnvs();rmSync(folder,{recursive:true,force:true})});
 const call=(authorization?:string,name?:string)=>app.request('/mcp/jsonrpc',{method:'POST',headers:{'content-type':'application/json',...(authorization===undefined?{}:{authorization})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:name?'tools/call':'tools/list',...(name?{params:{name,arguments:{name:'Institution fictive'}}}:{})})});
 const revoke=(client:string,token:string)=>app.request('/mcp/oauth/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client,client_secret:SECRET,token})});
 it.each([ACCESS,REFRESH])('un autre client ne révoque pas le jeton %s',async token=>{
  const r=await revoke('osd_A',token);expect(r.status).toBe(200);expect(await r.text()).toBe('');expect(store.findTokenByAccessHash(hashToken(ACCESS))).not.toBeNull();expect((await call('Bearer '+ACCESS)).status).toBe(200);
 });
 it.each([ACCESS,REFRESH])('le propriétaire révoque sa paire %s',async token=>{
  expect((await revoke('osd_B',token)).status).toBe(200);expect((await call('Bearer '+ACCESS)).status).toBe(401);expect(store.findTokenByRefreshHash(hashToken(REFRESH))).toBeNull();expect((await revoke('osd_B',token)).status).toBe(200);
 });
 it('un jeton tiers et un jeton inconnu donnent la même réponse',async()=>{
  const a=await revoke('osd_A',ACCESS),b=await revoke('osd_A','inconnu');expect([a.status,await a.text()]).toEqual([b.status,await b.text()]);
 });
 it('un client tiers ne consomme pas le refresh du propriétaire',async()=>{
  const refresh=(client:string)=>app.request('/mcp/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:client,client_secret:SECRET,refresh_token:REFRESH})});
  const denied=await refresh('osd_A');expect(denied.status).toBe(400);expect((await denied.json()).error).toBe('invalid_grant');expect(store.findTokenByRefreshHash(hashToken(REFRESH))).not.toBeNull();expect((await refresh('osd_B')).status).toBe(200);
 });
 it.each(['bearer','BEARER','BeArEr'])('le schéma %s identifie bien le compte',async scheme=>{
  const r=await call(scheme+' '+ACCESS);expect(r.status).toBe(200);expect(r.headers.get('x-ratelimit-tier')).toBe('pro');
 });
 it('un compte au type inconnu ne reçoit pas de droits implicites',async()=>{
  getDb().exec("PRAGMA ignore_check_constraints=ON; UPDATE mcp_clients SET tier='inconnu' WHERE client_id='osd_B'; PRAGMA ignore_check_constraints=OFF");
  const r=await call('Bearer '+ACCESS);expect(r.status).toBe(401);expect(r.headers.get('www-authenticate')).toContain('Bearer');expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_usage').get()).toEqual({n:0});
 });
 it('un marqueur de compte révoqué égal à zéro reste une révocation',async()=>{
  getDb().exec("UPDATE mcp_clients SET revoked_at=0 WHERE client_id='osd_B'");expect((await call('Bearer '+ACCESS)).status).toBe(401);expect((await revoke('osd_B',ACCESS)).status).toBe(401);
 });
 it('la révocation par authentification Basic reste fonctionnelle',async()=>{
  const r=await app.request('/mcp/oauth/revoke',{method:'POST',headers:{authorization:'Basic '+Buffer.from('osd_B:'+SECRET).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:ACCESS})});expect(r.status).toBe(200);expect((await call('Bearer '+ACCESS)).status).toBe(401);
 });
 it.each(['','Bearer','Bearer ','Basic abc','Bearer a b','Bearer a,b','Bearer\tabc','Bearer '+ 'a'.repeat(5000)])('une authentification malformée reste un refus',async authorization=>{
  const r=await call(authorization);expect(r.status).toBe(401);expect(r.headers.get('www-authenticate')).toContain('Bearer');expect(r.headers.get('cache-control')).toBe('no-store');
  const anonymous=await call();expect(anonymous.status).toBe(200);expect(anonymous.headers.get('x-ratelimit-remaining')).toBe('99');
 });
 it.each(['findTokenByAccessHash','findClientById','consumeQuota'])('une panne %s ne révèle aucun détail',async method=>{
  if(method==='consumeQuota')vi.spyOn(quota,'consumeQuota').mockImplementation(()=>{throw new Error('detail-prive-SQL-fictif')});
  else vi.spyOn(store,method as 'findTokenByAccessHash').mockImplementation(()=>{throw new Error('detail-prive-SQL-fictif')});
  const r=await call('Bearer '+ACCESS);expect(r.status).toBe(500);expect(await r.json()).toEqual({error:'server_error'});expect(r.headers.get('cache-control')).toBe('no-store');
 });
 it('une exception interne d’outil ne révèle ni réponse ni journal brut',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+120_000);
  const handler=vi.spyOn(kycCheckTool,'handler').mockImplementation(()=>{throw new Error('detail-prive-outil-fictif')});const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{});
  for(const auth of [undefined,'Bearer '+ACCESS,'Bearer '+ADMIN]){const r=await call(auth,'kyc_check');expect((await r.json()).error).toEqual({code:-32603,message:'Internal error'})}
  expect(handler).toHaveBeenCalledTimes(3);expect(warn).toHaveBeenCalledTimes(1);expect(error).not.toHaveBeenCalled();expect(JSON.stringify(warn.mock.calls)).not.toContain('detail-prive');
 });
 it('une promesse rejetée par un outil conserve la réponse générique',async()=>{
  const handler=vi.spyOn(tariffSemanticSearchTool,'handler').mockRejectedValue(new Error('detail-prive-asynchrone'));const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{});
  const r=await call('Bearer '+ADMIN,'tariff_semantic_search');expect((await r.json()).error).toEqual({code:-32603,message:'Internal error'});expect(handler).toHaveBeenCalledTimes(1);expect(error).not.toHaveBeenCalled();expect(JSON.stringify(warn.mock.calls)).not.toContain('detail-prive');
 });
 it.each([
  ['kyc_check',{name:'Institution fictive'}],['tariff_lookup',{hs8:'09011100',lang:'fr'}],['cross_walk',{code:'62',source:'NOGA_2008',target:'NACE_2.0'}]
 ])('l’outil public %s garde son accès anonyme',async(name,args)=>{
  const r=await app.request('/mcp/jsonrpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const body=await r.json();expect(r.status).toBe(200);expect(body.error).toBeUndefined();expect(body.result.isError).not.toBe(true);expect(body.result.content).toBeDefined();
 });
 it.each(['constructor','toString','hasOwnProperty','__proto__','inconnu'])('un nom hérité ou inconnu est un outil absent : %s',async name=>{
  for(const auth of [undefined,'Bearer '+ACCESS,'Bearer '+ADMIN]){const r=await call(auth,name);expect((await r.json()).error.code).toBe(-32601)}
 });
 it('un outil sans portée ne reçoit pas de droit implicite',()=>{
  const auth={client_id:'fictif',client_pk:1,tier:'pro' as const,scopes:SCOPES,admin:false};expect(isToolAllowed('kyc_check',null,auth)).toBe(false);expect(isToolAllowed('nouveau',null,auth)).toBe(false);expect(isToolAllowed('nouveau',null,{...auth,admin:true})).toBe(false);
 });
 it('le chemin administrateur garde les outils déclarés et l’accès public reste distinct',async()=>{
  expect((await call('bearer '+ADMIN)).headers.get('x-ratelimit-tier')).toBeNull();expect((await (await call('Bearer '+ADMIN,'kyc_check')).json()).error).toBeUndefined();expect((await (await call(undefined,'kyc_check')).json()).error).toBeUndefined();
 });
});
