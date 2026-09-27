import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/index.js';
import { getDb, closeDb } from '../../src/lib/db.js';
import { insertClient, insertToken, setClientTier } from '../../src/mcp/oauth/store.js';
import { hashToken, pkceChallengeS256 } from '../../src/mcp/oauth/crypto.js';
import { TIER_DEFAULT_SCOPES } from '../../src/mcp/oauth/scopes.js';
import { _resetRateLimit } from '../../src/mcp/rate-limit.js';

const CLIENT='osd_cycle_fictif',SECRET='secret-fictif-cycle-oauth',ACCESS='A'.repeat(43),REFRESH='R'.repeat(43);
describe('Portées durant le cycle OAuth, uniquement sur comptes fictifs',()=>{
 let folder:string;
 beforeEach(()=>{closeDb();_resetRateLimit();folder=mkdtempSync(join(tmpdir(),'osd-cycle42-'));vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));vi.stubEnv('OAUTH_SIGNING_SECRET','cle-fictive-cycle-oauth-assez-longue');vi.stubEnv('MCP_BEARER_TOKEN','')});
 afterEach(()=>{closeDb();_resetRateLimit();vi.unstubAllEnvs();rmSync(folder,{recursive:true,force:true})});
 const call=(token:string,name:string)=>createApp().request('/mcp/jsonrpc',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{name:'Institution fictive',query:'Recherche fictive'}}})});
 const provision=(scope='finma:read')=>{
  insertClient({client_id:CLIENT,client_secret_hash:hashToken(SECRET),name:'Démo',email:'demo@example.test',tier:'pro',scopes:TIER_DEFAULT_SCOPES.pro});
  insertToken({client_id:CLIENT,access_token_plain:ACCESS,refresh_token_plain:REFRESH,scope});
 };
 const refresh=(scope?:string)=>createApp().request('/mcp/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:CLIENT,client_secret:SECRET,refresh_token:REFRESH,...(scope===undefined?{}:{scope})})});
 it('le parcours inscription puis autorisation sans scope donne les droits gratuits explicites',async()=>{
  const app=createApp();const registered=await app.request('/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Client de démonstration',email:'demo@example.test',redirect_uris:['https://client.example.test/callback']})});expect(registered.status).toBe(201);const client=await registered.json();
  const verifier='V'.repeat(43),redirect='https://client.example.test/callback',query=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:redirect,code_challenge:pkceChallengeS256(verifier),code_challenge_method:'S256'});
  const authorize=await app.request('/mcp/oauth/authorize?'+query);expect(authorize.status).toBe(200);const form=new URLSearchParams();
  for(const match of (await authorize.text()).matchAll(/name="([^"]+)" value="([^"]*)"/g))form.set(match[1],match[2]);
  expect(form.get('scope')).toBe(TIER_DEFAULT_SCOPES.free.join(' '));form.set('decision','allow');
  const decision=await app.request('/mcp/oauth/authorize/decision',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});expect(decision.status).toBe(302);const code=new URL(decision.headers.get('location')!).searchParams.get('code')!;
  const response=await app.request('/mcp/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,client_secret:client.client_secret,code,code_verifier:verifier,redirect_uri:redirect})});expect(response.status).toBe(200);const issued=await response.json();
  expect(issued.scope).toBe(TIER_DEFAULT_SCOPES.free.join(' '));expect(getDb().prepare('SELECT scope FROM mcp_tokens').get()).toEqual({scope:issued.scope});expect((await (await call(issued.access_token,'kyc_check')).json()).error).toBeUndefined();
  expect((await (await call(issued.access_token,'tariff_semantic_search')).json()).error.code).toBe(-32001);
 });
 it.each([undefined,'finma:read'])('le renouvellement conserve le jeton limité, demande %s',async scope=>{
  provision();const response=await refresh(scope);expect(response.status).toBe(200);const issued=await response.json();expect(issued.scope).toBe('finma:read');expect((await (await call(issued.access_token,'tariff_semantic_search')).json()).error.code).toBe(-32001);expect((await (await call(issued.access_token,'kyc_check')).json()).error).toBeUndefined();
 });
 it.each(['tariff:semantic','finma:read tariff:semantic','inconnu',''])('refuse un renouvellement qui dépasse la portée originale ou est invalide (%s)',async scope=>{
  provision();const response=await refresh(scope);expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'invalid_scope'});expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_tokens WHERE revoked_at IS NULL').get()).toEqual({n:1});
  expect((await refresh()).status).toBe(200);
 });
 it('permet de réduire la portée au renouvellement sans modifier les droits du compte',async()=>{
  provision('finma:read tariff:read');const response=await refresh('finma:read');expect(response.status).toBe(200);const issued=await response.json();expect(issued.scope).toBe('finma:read');expect(getDb().prepare('SELECT scopes FROM mcp_clients').get()).toEqual({scopes:TIER_DEFAULT_SCOPES.pro.join(' ')});
 });
 it('respecte une rétrogradation réelle du compte après émission',async()=>{
  provision('finma:read tariff:semantic');setClientTier(CLIENT,'free');expect((await (await call(ACCESS,'tariff_semantic_search')).json()).error.code).toBe(-32001);const response=await refresh();expect(response.status).toBe(200);expect((await response.json()).scope).toBe('finma:read');
 });
 it('refuse le renouvellement sans droit commun et garde le jeton non révoqué',async()=>{
  provision('tariff:semantic');setClientTier(CLIENT,'free');const r=await refresh();expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'invalid_scope'});expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_tokens WHERE revoked_at IS NULL').get()).toEqual({n:1});
 });
 it('déduplique la portée demandée sans élargissement',async()=>{
  provision();const r=await refresh('finma:read finma:read');expect(r.status).toBe(200);expect((await r.json()).scope).toBe('finma:read');
 });

});
