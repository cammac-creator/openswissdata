import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../src/index.js';
import {getDb,closeDb} from '../../src/lib/db.js';
import {Hono} from 'hono';
import {oauthRouter} from '../../src/mcp/oauth/index.js';
import {insertClient} from '../../src/mcp/oauth/store.js';
import {hashToken,pkceChallengeS256} from '../../src/mcp/oauth/crypto.js';

describe('Corps OAuth bornés avant effet, bases fictives',()=>{
 let folder:string,app:ReturnType<typeof createApp>;
 beforeEach(()=>{closeDb();folder=mkdtempSync(join(tmpdir(),'osd-corps-'));vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));vi.stubEnv('OAUTH_SIGNING_SECRET','cle-fictive-corps-oauth');app=createApp();getDb()});
 afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(folder,{recursive:true,force:true})});
 it.each(['/register','/token','/revoke','/authorize/decision'])('refuse un corps trop long avant traitement %s sur les deux montages',async path=>{
  for(const [base,host] of [['/mcp/oauth','www.openswissdata.com'],['/oauth','mcp.openswissdata.com']]){
   const r=await app.request(base+path,{method:'POST',headers:{host,'content-type':path==='/register'?'application/json':'application/x-www-form-urlencoded'},body:'x'.repeat(16385)});expect(r.status).toBe(413);expect(await r.json()).toEqual({error:'request_too_large'});expect(r.headers.get('cache-control')).toBe('no-store');
  }
  for(const table of ['mcp_clients','mcp_tokens','mcp_oauth_codes'])expect(getDb().prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:0});
 });
 it.each(['0','2','incorrect'])('mesure les octets même si Content-Length ment : %s',async length=>{
  const r=await app.request('/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json','content-length':length},body:'x'.repeat(16385)});expect(r.status).toBe(413);expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_clients').get()).toEqual({n:0});
 });
 it('borne un flux morcelé sans longueur annoncée',async()=>{
  const body=new ReadableStream<Uint8Array>({start(c){for(let i=0;i<5;i++)c.enqueue(new Uint8Array(4096));c.close()}});
  const request=new Request('http://localhost/mcp/oauth/token',{method:'POST',body,duplex:'half'} as RequestInit);const r=await app.request(request);expect(r.status).toBe(413);
 });
 it('arrête la lecture d’un flux trop volumineux',async()=>{
  const cancel=vi.fn();let chunks=0;const body=new ReadableStream<Uint8Array>({pull(c){chunks++;c.enqueue(new Uint8Array(8192))},cancel});
  const r=await app.request(new Request('http://localhost/mcp/oauth/token',{method:'POST',body,duplex:'half'} as RequestInit));expect(r.status).toBe(413);expect(cancel).toHaveBeenCalledTimes(1);expect(chunks).toBeLessThanOrEqual(4);
 });
 it('un flux interrompu devient une erreur de requête sans effet',async()=>{
  const body=new ReadableStream<Uint8Array>({start(c){c.error(new Error('detail-prive-fictif'))}});const r=await app.request(new Request('http://localhost/mcp/oauth/token',{method:'POST',body,duplex:'half'} as RequestInit));expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'invalid_request'});
 });
 it('un flux verrouillé par un middleware antérieur est refusé proprement',async()=>{
  const locked=new Hono();locked.use('*',async(c,next)=>{const reader=c.req.raw.body!.getReader();try{await next()}finally{reader.releaseLock()}});locked.route('/oauth',oauthRouter);
  const r=await locked.request('/oauth/token',{method:'POST',body:'fictif'});expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'invalid_request'});
 });
 it('accepte exactement la limite réelle avec un JSON valide',async()=>{
  const base=JSON.stringify({name:'Exemple',email:'demo@example.test',padding:''});const body=base.replace('"padding":""','"padding":"'+'x'.repeat(16384-Buffer.byteLength(base))+'"');expect(Buffer.byteLength(body)).toBe(16384);
  const r=await app.request('/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body});expect(r.status).toBe(201);
 });
 it('la limite OAuth ne se propage pas au point JSON-RPC voisin',async()=>{
  const r=await app.request('/mcp/jsonrpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping',padding:'x'.repeat(17000)})});expect(r.status).toBe(200);expect(await r.json()).toEqual({jsonrpc:'2.0',id:1,result:{}});
 });
 it('la limite mesure des octets UTF8, pas des caractères',async()=>{
  const r=await app.request('/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Exemple',email:'demo@example.test',padding:'é'.repeat(9000)})});expect(r.status).toBe(413);
 });
 it.each(['/token','/revoke','/authorize/decision'])('un formulaire illisible est refusé sans détail %s',async path=>{
  const error=vi.spyOn(console,'error').mockImplementation(()=>{});const r=await app.request('/mcp/oauth'+path,{method:'POST',headers:{'content-type':'multipart/form-data'},body:'contenu-fictif'});expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'invalid_request'});expect(error).not.toHaveBeenCalled();expect(r.headers.get('cache-control')).toBe('no-store');
 });
 it('le domaine MCP ne met pas en cache une inscription valide ni une autorisation refusée',async()=>{
  const r=await app.request('/oauth/register',{method:'POST',headers:{host:'mcp.openswissdata.com','content-type':'application/json'},body:JSON.stringify({name:'Exemple',email:'demo@example.test'})});expect(r.status).toBe(201);expect(r.headers.get('cache-control')).toBe('no-store');expect((await r.json()).client_secret).toBeTruthy();
  const denied=await app.request('/oauth/authorize',{headers:{host:'mcp.openswissdata.com'}});expect(denied.status).toBe(400);expect(denied.headers.get('cache-control')).toBe('no-store');
 });
 it('la redirection porteuse du code reste sans cache sur les deux montages',async()=>{
  insertClient({client_id:'osd_corps_fictif',client_secret_hash:hashToken('secret-fictif'),name:'Exemple',email:'demo@example.test',tier:'free',scopes:['finma:read']});
  for(const [base,host] of [['/mcp/oauth','www.openswissdata.com'],['/oauth','mcp.openswissdata.com']]){
   const r=await app.request(base+'/authorize/decision',{method:'POST',headers:{host,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:'osd_corps_fictif',decision:'allow',redirect_uri:'https://client.example.test/callback',code_challenge:pkceChallengeS256('V'.repeat(43)),code_challenge_method:'S256',scope:'finma:read'})});
   expect(r.status).toBe(302);expect(new URL(r.headers.get('location')!).searchParams.get('code')).toBeTruthy();expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('pragma')).toBe('no-cache');
  }
 });
});
