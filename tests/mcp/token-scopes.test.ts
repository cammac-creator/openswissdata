import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createApp } from '../../src/index.js';
import { getDb, closeDb } from '../../src/lib/db.js';
import { insertClient, insertToken } from '../../src/mcp/oauth/store.js';
import { hashToken } from '../../src/mcp/oauth/crypto.js';
import { oauthVerify, type MCPAuthVar } from '../../src/mcp/oauth/verify.js';
import { listTools } from '../../src/mcp/server.js';
import { tariffSemanticSearchTool } from '../../src/mcp/tools/tariff-semantic-search.js';
import { _resetRateLimit } from "../../src/mcp/rate-limit.js";
import { TIER_DEFAULT_SCOPES, SCOPES, TOOL_SCOPE } from '../../src/mcp/oauth/scopes.js';

const ACCESS='A'.repeat(43),CLIENT='osd_client_scopes_fictif';
describe('Restrictions du jeton MCP et droits actuels du compte',()=>{
 let dir:string;
 beforeEach(()=>{
  closeDb();_resetRateLimit();dir=mkdtempSync(join(tmpdir(),'osd-scopes42-'));vi.stubEnv('DATABASE_PATH',join(dir,'fictive.sqlite'));vi.stubEnv('OAUTH_SIGNING_SECRET','cle-fictive-scopes-aucun-acces-reel');vi.stubEnv('MCP_BEARER_TOKEN','');
  insertClient({client_id:CLIENT,client_secret_hash:hashToken('secret-fictif'),name:'Compte de démonstration',email:'compte@example.test',tier:'pro',scopes:TIER_DEFAULT_SCOPES.pro});
  insertToken({client_id:CLIENT,access_token_plain:ACCESS,refresh_token_plain:null,scope:'finma:read'});
 });
 afterEach(()=>{closeDb();_resetRateLimit();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true})});
 const context=async()=>{
  const app=new Hono<MCPAuthVar>();app.use('*',oauthVerify());app.get('/',c=>c.json(c.get('mcp_auth')));
  return (await app.request('/',{headers:{authorization:'Bearer '+ACCESS}})).json();
 };
 it('ne donne pas les autres droits Pro au jeton limité à FINMA',async()=>{
  expect((await context()).scopes).toEqual(['finma:read']);
 });
 it('applique immédiatement le retrait de droits du compte sans réécrire le jeton',async()=>{
  getDb().prepare('UPDATE mcp_clients SET scopes=? WHERE client_id=?').run('tariff:read',CLIENT);
  expect((await context()).scopes).toEqual([]);expect(getDb().prepare('SELECT scope FROM mcp_tokens').get()).toEqual({scope:'finma:read'});
 });
 it('une montée en gamme n’élargit pas les droits du jeton existant',async()=>{
  getDb().prepare("UPDATE mcp_clients SET tier='free',scopes='finma:read' WHERE client_id=?").run(CLIENT);expect((await context()).scopes).toEqual(['finma:read']);
  getDb().prepare("UPDATE mcp_clients SET tier='pro',scopes=? WHERE client_id=?").run(TIER_DEFAULT_SCOPES.pro.join(' '),CLIENT);expect((await context()).scopes).toEqual(['finma:read']);
 });
 it.each(['','inconnu','FINMA:READ','   '])('une portée vide ou inconnue ne devient jamais tous les droits (%s)',async scope=>{
  getDb().prepare('UPDATE mcp_tokens SET scope=?').run(scope);expect((await context()).scopes).toEqual([]);
 });
 it('déduplique les droits reconnus et ignore ceux absents du compte',async()=>{
  getDb().prepare('UPDATE mcp_tokens SET scope=?').run('finma:read finma:read invente tarif:read tariff:history');
  getDb().prepare('UPDATE mcp_clients SET scopes=? WHERE client_id=?').run('finma:read tariff:read',CLIENT);expect((await context()).scopes).toEqual(['finma:read']);
 });
 it('conserve les droits complets si compte et jeton les portent tous deux',async()=>{
  getDb().prepare('UPDATE mcp_tokens SET scope=?').run(TIER_DEFAULT_SCOPES.pro.join(' '));expect((await context()).scopes).toEqual(TIER_DEFAULT_SCOPES.pro);
 });
 it.each([['/mcp/jsonrpc','www.openswissdata.com'],['/jsonrpc','mcp.openswissdata.com']])('refuse un outil hors portée avant exécution sur %s (%s)',async(path,host)=>{
  const handler=vi.spyOn(tariffSemanticSearchTool,'handler');
  const r=await createApp().request(path,{method:'POST',headers:{host,authorization:'Bearer '+ACCESS,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'tariff_semantic_search',arguments:{query:'exemple fictif'}}})});
  expect(r.status).toBe(200);expect((await r.json()).error.code).toBe(-32001);expect(handler).not.toHaveBeenCalled();
 });
 it('autorise toujours FINMA avec sa portée effective',async()=>{
  const r=await createApp().request('/mcp/jsonrpc',{method:'POST',headers:{authorization:'Bearer '+ACCESS,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'kyc_check',arguments:{name:'Institution strictement fictive test scopes'}}})});
  expect(r.status).toBe(200);const body=await r.json();expect(body.error).toBeUndefined();expect(body.result.isError).not.toBe(true);expect(body.result.content).toBeInstanceOf(Array);
 });
 it('un jeton sans droits ne bénéficie pas du repli anonyme',async()=>{
  getDb().prepare("UPDATE mcp_tokens SET scope=''").run();
  const body={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'kyc_check',arguments:{name:'Institution strictement fictive'}}};
  const app=createApp(),authenticated=await app.request('/mcp/jsonrpc',{method:'POST',headers:{authorization:'Bearer '+ACCESS,'content-type':'application/json'},body:JSON.stringify(body)});
  expect((await authenticated.json()).error.code).toBe(-32001);
  const anonymous=await app.request('/mcp/jsonrpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});expect((await anonymous.json()).error).toBeUndefined();
 });
 it('garde le quota du compte et consomme une seule unité par demande authentifiée',async()=>{
  const first=await context();expect(first.tier).toBe('pro');expect(first.admin).toBe(false);
  const usage=()=>getDb().prepare('SELECT day_count,month_count,total_count FROM mcp_usage WHERE client_id=?').get(CLIENT);expect(usage()).toEqual({day_count:1,month_count:1,total_count:1});await context();expect(usage()).toEqual({day_count:2,month_count:2,total_count:2});
 });
 it('conserve le refus des jetons révoqués et expirés et des comptes révoqués',async()=>{
  const app=new Hono<MCPAuthVar>();app.use('*',oauthVerify());app.get('/',c=>c.json(c.get('mcp_auth')));
  const request=()=>app.request('/',{headers:{authorization:'Bearer '+ACCESS}}),db=getDb();
  db.prepare('UPDATE mcp_tokens SET revoked_at=?').run(Date.now());expect((await request()).status).toBe(401);
  db.prepare('UPDATE mcp_tokens SET revoked_at=NULL,expires_at=?').run(Date.now()-1);expect((await request()).status).toBe(401);
  db.prepare('UPDATE mcp_tokens SET expires_at=?').run(Date.now()+100000);db.prepare('UPDATE mcp_clients SET revoked_at=?').run(Date.now());expect((await request()).status).toBe(401);
 });
 it('laisse le chemin administrateur historique distinct des jetons clients',async()=>{
  vi.stubEnv('MCP_BEARER_TOKEN',ACCESS);const auth=await context();expect(auth.admin).toBe(true);expect(auth.client_id).toBe('admin');expect(auth.scopes).toEqual(SCOPES);
 });

 it('chaque outil enregistré exige une portée connue',()=>{
  for(const tool of listTools().tools)expect(TOOL_SCOPE[tool.name]).toBeDefined();
 });

 it('garde les portées pour chaque appel d’un lot JSON-RPC',async()=>{
  const handler=vi.spyOn(tariffSemanticSearchTool,'handler');const body=['kyc_check','tariff_semantic_search'].map((name,id)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{name:'Institution fictive',query:'Recherche fictive'}}}));
  const r=await createApp().request('/mcp/jsonrpc',{method:'POST',headers:{authorization:'Bearer '+ACCESS,'content-type':'application/json'},body:JSON.stringify(body)});expect(r.status).toBe(200);const results=await r.json();expect(results[0].error).toBeUndefined();expect(results[1].error.code).toBe(-32001);expect(handler).not.toHaveBeenCalled();
 });

});
