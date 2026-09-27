import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../src/index.js';
import {closeDb,getDb} from '../../src/lib/db.js';
import {insertClient,insertToken,insertAuthCode} from '../../src/mcp/oauth/store.js';
import {hashToken,pkceChallengeS256} from '../../src/mcp/oauth/crypto.js';

const CLIENT='osd_identite_fictive',SECRET='secret-fictif',ACCESS='A'.repeat(43),REFRESH='R'.repeat(43),CODE='C'.repeat(43),VERIFIER='V'.repeat(43),REDIRECT='https://client.example.test/callback';
const basic=(id=CLIENT,secret=SECRET)=>'Basic '+Buffer.from(id+':'+secret).toString('base64');
describe('Authentification OAuth sans mélange sur base fictive',()=>{
 let folder:string,app:ReturnType<typeof createApp>;
 beforeEach(()=>{closeDb();folder=mkdtempSync(join(tmpdir(),'osd-auth-client-'));vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));vi.stubEnv('OAUTH_SIGNING_SECRET','cle-fictive-auth-client');
  insertClient({client_id:CLIENT,client_secret_hash:hashToken(SECRET),name:'Fictif',email:'fictif@example.test',tier:'free',scopes:['finma:read']});
  insertToken({client_id:CLIENT,access_token_plain:ACCESS,refresh_token_plain:REFRESH,scope:'finma:read'});
  insertAuthCode({code:hashToken(CODE),client_id:CLIENT,redirect_uri:REDIRECT,code_challenge:pkceChallengeS256(VERIFIER),code_challenge_method:'S256',scope:'finma:read',state:null});app=createApp();
 });
 afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(folder,{recursive:true,force:true})});
 const fields=(kind:string)=>kind==='revoke'?{token:ACCESS}:{grant_type:kind,code:CODE,code_verifier:VERIFIER,redirect_uri:REDIRECT,refresh_token:REFRESH};
 const call=(kind:string,auth:string|undefined,body:URLSearchParams|FormData)=>app.request('/mcp/oauth/'+(kind==='revoke'?'revoke':'token'),{method:'POST',headers:auth===undefined?{}:{authorization:auth},body});
 const untouched=()=>{expect(getDb().prepare('SELECT used_at FROM mcp_oauth_codes').get()).toEqual({used_at:null});expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_tokens WHERE revoked_at IS NULL').get()).toEqual({n:1});expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_tokens').get()).toEqual({n:1})};
 for(const kind of ['authorization_code','refresh_token','revoke']){
  it.each(['', 'Bearer fictif', 'Basic ###', basic(CLIENT,''), basic()])(`refuse le mélange en-tête/formulaire avant effet : ${kind} / %s`,async auth=>{
   const r=await call(kind,auth,new URLSearchParams({...fields(kind),client_id:CLIENT,client_secret:SECRET}));expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'invalid_request'});expect(r.headers.get('cache-control')).toBe('no-store');untouched();
  });
  it.each(['Basic ###','Basic '+Buffer.from('sans-separateur').toString('base64'),basic(CLIENT,''),basic()+', autre',basic().replace('Basic ','Bearer '),'Basic '+Buffer.from([0xff,58,65]).toString('base64'),'Basic '+Buffer.from(CLIENT+':%ZZ').toString('base64')])(`refuse un Basic malformé : ${kind} / %s`,async auth=>{
   const r=await call(kind,auth,new URLSearchParams(fields(kind)));expect(r.status).toBe(401);expect(await r.json()).toEqual({error:'invalid_client'});expect(r.headers.get('www-authenticate')).toContain('Basic');untouched();
  });
  it.each(['client_id','client_secret'])(`refuse le paramètre dupliqué : ${kind} / %s`,async key=>{
   const body=new URLSearchParams({...fields(kind),client_id:CLIENT,client_secret:SECRET});body.append(key,key==='client_id'?CLIENT:SECRET);const r=await call(kind,undefined,body);expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'invalid_request'});untouched();
  });
  it.each(['Basic','basic','bAsIc'])(`préserve les identifiants valides et la casse du schéma : ${kind} / %s`,async scheme=>{
   const r=await call(kind,basic().replace('Basic',scheme),new URLSearchParams(fields(kind)));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');
   if(kind==='revoke')expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_tokens WHERE revoked_at IS NULL').get()).toEqual({n:0});else expect((await r.json()).scope).toBe('finma:read');
  });
  it(`préserve le formulaire sans en-tête : ${kind}`,async()=>{expect((await call(kind,undefined,new URLSearchParams({...fields(kind),client_id:CLIENT,client_secret:SECRET}))).status).toBe(200)});
 }
 it.each(['authorization_code','refresh_token','revoke'])('un compte révoqué au marqueur zéro reste refusé : %s',async kind=>{
  getDb().exec('UPDATE mcp_clients SET revoked_at=0');const r=await call(kind,basic(),new URLSearchParams(fields(kind)));expect(r.status).toBe(401);expect(r.headers.get('www-authenticate')).toContain('Basic');untouched();
 });
 it.each(['grant_type','code','code_verifier','redirect_uri','refresh_token'])('un paramètre métier dupliqué ne consomme pas de code : %s',async key=>{
  const body=new URLSearchParams(fields('authorization_code'));body.append(key,body.get(key)!);expect((await call('authorization_code',basic(),body)).status).toBe(400);untouched();
 });
 it('une révocation sans en-tête ne lit pas des identifiants de requête URL',async()=>{
  const r=await app.request('/mcp/oauth/revoke?client_id='+CLIENT+'&client_secret='+SECRET,{method:'POST',body:new URLSearchParams({token:ACCESS})});expect(r.status).toBe(401);untouched();
 });
 it.each([basic(CLIENT,'mauvais-secret'),'Basic YQ','Basic '+Buffer.from('\ufeff'+CLIENT+':'+SECRET).toString('base64'),basic().replace('Basic ','Basic\t')])('refuse sans effet les Basic non valides supplémentaires %s',async auth=>{
  const r=await call('refresh_token',auth,new URLSearchParams(fields('refresh_token')));expect(r.status).toBe(401);untouched();
 });
 it('accepte plusieurs espaces séparant le schéma Basic',async()=>{expect((await call('refresh_token',basic().replace('Basic ','Basic   '),new URLSearchParams(fields('refresh_token')))).status).toBe(200)});
 it.each([{}, {token:''}])('le jeton à révoquer doit être présent %j',async body=>{expect((await call('revoke',basic(),new URLSearchParams(body))).status).toBe(400);untouched()});
 it('une méthode inconnue ne renvoie pas le texte reçu',async()=>{
  const r=await call('texte-fictif-prive',basic(),new URLSearchParams({grant_type:'texte-fictif-prive'}));expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'unsupported_grant_type'});untouched();
 });
 it('le Basic OAuth décode une seule fois les composants encodés du formulaire',async()=>{
  const id='osd_fictif:+ espace',secret='secret:+ %é';insertClient({client_id:id,client_secret_hash:hashToken(secret),name:'Fictif',email:'autre@example.test',tier:'free',scopes:['finma:read']});insertToken({client_id:id,access_token_plain:'B'.repeat(43),refresh_token_plain:null,scope:'finma:read'});
  const formEncode=(v:string)=>new URLSearchParams({v}).toString().slice(2);
  const r=await call('revoke',basic(formEncode(id),formEncode(secret)),new URLSearchParams({token:'B'.repeat(43)}));expect(r.status).toBe(200);expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_tokens WHERE client_id=? AND revoked_at IS NULL').get(id)).toEqual({n:0});
 });
 it('un multipart dupliqué est refusé sans retenir la dernière valeur',async()=>{
  const body=new FormData();body.set('client_id',CLIENT);body.append('client_id',CLIENT);body.set('client_secret',SECRET);body.set('token',ACCESS);expect((await call('revoke',undefined,body)).status).toBe(400);untouched();
 });
 it('un fichier multipart ne peut pas remplacer un identifiant',async()=>{
  const body=new FormData();body.set('client_id',CLIENT);body.set('client_secret',new Blob([SECRET]),'fictif.txt');body.set('token',ACCESS);expect((await call('revoke',undefined,body)).status).toBe(400);untouched();
 });
});
