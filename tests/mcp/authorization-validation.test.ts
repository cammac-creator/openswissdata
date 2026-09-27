import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createApp} from '../../src/index.js';
import {getDb, closeDb} from '../../src/lib/db.js';
import {hashToken, pkceChallengeS256} from '../../src/mcp/oauth/crypto.js';
import {insertClient, insertToken} from '../../src/mcp/oauth/store.js';

const URI='https://client.example.test/callback?source=demo', VERIFIER='V'.repeat(43);
describe('Autorisations et destinations enregistrées, uniquement fictives',()=>{
 let folder:string,app:ReturnType<typeof createApp>,client:{client_id:string;client_secret:string};
 const form=(path:string,body:URLSearchParams,extra:Record<string,string>={})=>app.request('/mcp/oauth'+path,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...extra},body});
 const fields=()=>({response_type:'code',client_id:client.client_id,redirect_uri:URI,code_challenge:pkceChallengeS256(VERIFIER),code_challenge_method:'S256',scope:'finma:read',state:'état + &= ?'});
 const authorize=(change:Record<string,string>={})=>app.request('/mcp/oauth/authorize?'+new URLSearchParams({...fields(),...change}));
 const decide=(change:Record<string,string>={})=>form('/authorize/decision',new URLSearchParams({...fields(),decision:'allow',...change}));
 const counts=()=>getDb().prepare('SELECT COUNT(*) n FROM mcp_oauth_codes').get();
 beforeEach(async()=>{closeDb();folder=mkdtempSync(join(tmpdir(),'osd-autorisation-'));vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));vi.stubEnv('OAUTH_SIGNING_SECRET','cle-fictive-autorisations-assez-longue');app=createApp();const r=await app.request('/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Application fictive',email:'fictive@example.test',redirect_uris:[URI]})});expect(r.status).toBe(201);client=await r.json()});
 afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(folder,{recursive:true,force:true})});

 it.each(['https://autre.example.test/cb','http://example.test/cb','javascript:alert(1)','data:text/html,exemple','https://client.example.test/callback?source=autre',URI+'#fragment','https://client.example.test/callback?source=demo&code=ancien'])('refuse une destination non enregistrée en lecture, accord et refus : %s',async redirect_uri=>{
  for(const r of [await authorize({redirect_uri}),await decide({redirect_uri}),await decide({redirect_uri,decision:'deny'})]){expect(r.status).toBe(400);expect(r.headers.get('location')).toBeNull();expect(r.headers.get('cache-control')).toBe('no-store')}
  expect(counts()).toEqual({n:0});
 });
 it.each(['plain','inconnue',''])('refuse la méthode PKCE %s aux deux étapes',async code_challenge_method=>{
  for(const r of [await authorize({code_challenge_method}),await decide({code_challenge_method})])expect(r.status).toBe(400);expect(counts()).toEqual({n:0});
 });
 it.each(['A'.repeat(42),'A'.repeat(44),'!'.repeat(43),'A'.repeat(42)+'B','é'.repeat(43)])('refuse un challenge S256 mal formé (%s)',async code_challenge=>{
  expect((await authorize({code_challenge})).status).toBe(400);expect((await decide({code_challenge})).status).toBe(400);expect(counts()).toEqual({n:0});
 });
 it.each(['client_id','redirect_uri','scope','state','code_challenge','code_challenge_method','response_type'])('refuse le paramètre répété %s',async key=>{
  const query=new URLSearchParams(fields());query.append(key,query.get(key)!);expect((await app.request('/mcp/oauth/authorize?'+query)).status).toBe(400);query.set('decision','allow');expect((await form('/authorize/decision',query)).status).toBe(400);expect(counts()).toEqual({n:0});
 });
 it.each(['','inconnu','finma:read inconnu','tariff:semantic','finma:read\ntariff:read'])('refuse une portée invalide ou non accordée : %s',async scope=>{
  expect((await authorize({scope})).status).toBe(400);expect((await decide({scope})).status).toBe(400);expect(counts()).toEqual({n:0});
 });
 it.each(['allow','deny'])('vérifie le client même pour la décision %s',async decision=>{
  expect((await decide({client_id:'inconnu',decision})).status).toBe(400);getDb().exec('UPDATE mcp_clients SET revoked_at=0');expect((await authorize()).status).toBe(400);expect((await decide({decision})).status).toBe(400);expect(counts()).toEqual({n:0});
 });
 it('recontrôle les droits après affichage',async()=>{expect((await authorize()).status).toBe(200);getDb().exec("UPDATE mcp_clients SET scopes='tariff:read'");expect((await decide()).status).toBe(400);expect(counts()).toEqual({n:0})});
 it.each(['','autre'])('une décision inconnue ne devient pas un refus redirigé : %s',async decision=>{const r=await decide({decision});expect(r.status).toBe(400);expect(r.headers.get('location')).toBeNull();expect(counts()).toEqual({n:0})});
 it('conserve la query enregistrée et le state opaque, puis échange le code une seule fois',async()=>{
  const r=await decide();expect(r.status).toBe(302);const u=new URL(r.headers.get('location')!);expect(u.searchParams.get('source')).toBe('demo');expect(u.searchParams.get('state')).toBe(fields().state);expect(u.searchParams.getAll('code')).toHaveLength(1);
  const body=new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,client_secret:client.client_secret,code:u.searchParams.get('code')!,code_verifier:VERIFIER,redirect_uri:URI});const token=await form('/token',body);expect(token.status).toBe(200);expect((await token.json()).scope).toBe('finma:read');expect((await form('/token',body)).status).toBe(400);
 });
 it('le refus valide conserve query/state et n’émet aucun code',async()=>{const r=await decide({decision:'deny'});expect(r.status).toBe(302);const u=new URL(r.headers.get('location')!);expect(u.searchParams.get('source')).toBe('demo');expect(u.searchParams.get('state')).toBe(fields().state);expect(u.searchParams.get('error')).toBe('access_denied');expect(counts()).toEqual({n:0})});
 it.each([['/mcp/oauth','www.openswissdata.com'],['/oauth','mcp.openswissdata.com']])('le formulaire reste sur son montage %s',async(base,host)=>{const r=await app.request(base+'/authorize?'+new URLSearchParams(fields()),{headers:{host}});expect(r.status).toBe(200);const html=await r.text();expect(html).toContain('action="'+base+'/authorize/decision"');expect(r.headers.get('referrer-policy')).toBe('no-referrer');expect(r.headers.get('content-security-policy')).toContain("form-action 'self'")});
 it('ne reflète pas les valeurs invalides dans une erreur',async()=>{const r=await authorize({client_id:'marqueur-prive-fictif',redirect_uri:'marqueur-prive-fictif'});expect(r.status).toBe(400);expect(await r.text()).not.toContain('marqueur-prive-fictif')});

 it.each([[],['javascript:alert(1)'],['https://client.example.test/#fragment'],['http://example.test/cb'],['https://nom:secret@example.test/cb'],[URI,URI],Array(11).fill(URI),['https://client.example.test/cb?code=ancien']].map(v=>[v]))('refuse une inscription avec destinations invalides (%j)',async redirect_uris=>{const r=await app.request('/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Fictive',email:'fictive@example.test',redirect_uris})});expect(r.status).toBe(400);expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_clients').get()).toEqual({n:1})});
 it('persiste la liste et la relit après ouverture de la base',()=>{closeDb();expect(getDb().prepare('SELECT redirect_uri FROM mcp_client_redirect_uris WHERE client_id=?').all(client.client_id)).toEqual([{redirect_uri:URI}])});
 it('une inscription historique reste utilisable mais exige une configuration authentifiée avant autorisation',async()=>{
  const id='osd_historique_fictif',secret='secret-historique-fictif';insertClient({client_id:id,client_secret_hash:hashToken(secret),name:'Historique',email:'historique@example.test',tier:'free',scopes:['finma:read']});insertToken({client_id:id,access_token_plain:'A'.repeat(43),refresh_token_plain:'R'.repeat(43),scope:'finma:read'});
  const refresh=await form('/token',new URLSearchParams({grant_type:'refresh_token',client_id:id,client_secret:secret,refresh_token:'R'.repeat(43)}));expect(refresh.status).toBe(200);
  expect((await decide({client_id:id})).status).toBe(400);
  const config=new URLSearchParams({client_id:id,client_secret:'faux',redirect_uris:JSON.stringify([URI])});expect((await form('/redirect-uris',config)).status).toBe(401);expect((await decide({client_id:id})).status).toBe(400);
  config.set('client_secret',secret);const saved=await form('/redirect-uris',config);expect(saved.status).toBe(200);expect((await saved.json()).redirect_uris).toEqual([URI]);expect((await decide({client_id:id})).status).toBe(302);
 });
 it('revalide aussi les destinations à l’échange, sans consommer le code en cas de retrait',async()=>{const r=await decide();const code=new URL(r.headers.get('location')!).searchParams.get('code')!;const config=new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,redirect_uris:JSON.stringify(['https://client.example.test/autre'])});expect((await form('/redirect-uris',config)).status).toBe(200);const response=await form('/token',new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,client_secret:client.client_secret,code,code_verifier:VERIFIER,redirect_uri:URI}));expect(response.status).toBe(400);expect(getDb().prepare('SELECT used_at FROM mcp_oauth_codes').get()).toEqual({used_at:null})});
 it.each(['http://localhost:8765/callback','http://127.0.0.1:8765/callback'])('autorise une boucle locale enregistrée exactement : %s',async uri=>{
  const r=await form('/redirect-uris',new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,redirect_uris:JSON.stringify([uri])}));expect(r.status).toBe(200);expect((await decide({redirect_uri:uri})).status).toBe(302);expect((await decide({redirect_uri:uri.replace('8765','8766')})).status).toBe(400);
 });
 it.each(['https://a..b/cb','https://a-.b/cb','http://[::1]:8765/callback','https://client.example.test/cb?iss=x','https://a;b.com/cb','http://127.1/cb','http://localhost.example.test/cb','https://client.example.test\\@autre.test/cb','https://client.example.test/%0d%0aLocation:autre','https://client.example.test/cb%','https://*.example.test/cb',' https://client.example.test/cb','https://client.example.test/cb#','https://client.example.test/cb?state=x'])('refuse une adresse ambiguë lors de la configuration : %s',async uri=>{
  const r=await form('/redirect-uris',new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,redirect_uris:JSON.stringify([uri])}));expect(r.status).toBe(400);expect((await decide()).status).toBe(302);
 });
 it('la configuration Basic ne peut se mélanger au formulaire et un client révoqué reste refusé',async()=>{
  const auth='Basic '+Buffer.from(client.client_id+':'+client.client_secret).toString('base64');const body=new URLSearchParams({redirect_uris:JSON.stringify([URI])});expect((await form('/redirect-uris',body,{authorization:auth})).status).toBe(200);
  body.set('client_id',client.client_id);expect((await form('/redirect-uris',body,{authorization:auth})).status).toBe(400);body.delete('client_id');getDb().exec('UPDATE mcp_clients SET revoked_at=0');expect((await form('/redirect-uris',body,{authorization:auth})).status).toBe(401);
 });
 it('un doublon de configuration est refusé avant modification',async()=>{
  const body=new URLSearchParams({redirect_uris:JSON.stringify([URI]),client_id:client.client_id,client_secret:client.client_secret});body.append('redirect_uris',JSON.stringify(['https://autre.example.test/cb']));expect((await form('/redirect-uris',body)).status).toBe(400);expect(getDb().prepare('SELECT redirect_uri FROM mcp_client_redirect_uris').all()).toEqual([{redirect_uri:URI}]);
 });
 it.each(['ABORT','ROLLBACK'])('une panne annule le remplacement de la liste (%s)',async mode=>{
  getDb().exec(`CREATE TRIGGER panne_fictive BEFORE INSERT ON mcp_client_redirect_uris BEGIN SELECT RAISE(${mode},'detail-prive-fictif'); END`);
  const r=await form('/redirect-uris',new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,redirect_uris:JSON.stringify(['https://autre.example.test/cb'])}));expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'temporarily_unavailable'});expect(getDb().prepare('SELECT redirect_uri FROM mcp_client_redirect_uris').all()).toEqual([{redirect_uri:URI}]);expect(getDb().inTransaction).toBe(false);
 });
 it('une panne de registre annule aussi la nouvelle inscription',async()=>{
  getDb().exec("CREATE TRIGGER panne_fictive BEFORE INSERT ON mcp_client_redirect_uris BEGIN SELECT RAISE(ABORT,'detail-prive-fictif'); END");const r=await app.request('/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Fictive',email:'fictive@example.test',redirect_uris:[URI]})});expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'temporarily_unavailable'});expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_clients').get()).toEqual({n:1});
 });
 it('un échec d’écriture de code ne renvoie pas de redirection ni de détail',async()=>{getDb().exec("CREATE TRIGGER panne_fictive BEFORE INSERT ON mcp_oauth_codes BEGIN SELECT RAISE(ABORT,'detail-prive-fictif'); END");const r=await decide();expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'temporarily_unavailable'});expect(r.headers.get('location')).toBeNull();expect(counts()).toEqual({n:0})});
 it('migration additive idempotente sans adresse supposée ni changement du client',()=>{
  const row=getDb().prepare('SELECT * FROM mcp_clients').get();closeDb();const db=new Database(join(folder,'fictive.sqlite'));db.exec('DROP TABLE mcp_client_redirect_uris');db.close();expect(getDb().prepare('SELECT * FROM mcp_clients').get()).toEqual(row);expect(getDb().prepare('SELECT COUNT(*) n FROM mcp_client_redirect_uris').get()).toEqual({n:0});closeDb();expect(getDb().prepare('SELECT * FROM mcp_clients').get()).toEqual(row);
 });
 it('une copie de sûreté fictive conserve la liste et reste lisible par l’ancien schéma',async()=>{
  const backup=join(folder,'restauration-fictive.sqlite');await getDb().backup(backup);closeDb();const restored=getDb(backup);expect(restored.prepare('SELECT redirect_uri FROM mcp_client_redirect_uris').all()).toEqual([{redirect_uri:URI}]);expect(restored.pragma('integrity_check',{simple:true})).toBe('ok');expect(restored.pragma('foreign_key_check')).toEqual([]);
  const schema=readFileSync(fileURLToPath(new URL('../../src/db/schema.sql',import.meta.url)),'utf8').replace(/CREATE TABLE IF NOT EXISTS mcp_client_redirect_uris \([\s\S]*?\n\);/,'');restored.exec(schema);expect(restored.prepare('SELECT redirect_uri FROM mcp_client_redirect_uris').all()).toEqual([{redirect_uri:URI}]);
 });
 it('refuse un ancien code plain sans le consommer',async()=>{const result=await decide();const code=new URL(result.headers.get('location')!).searchParams.get('code')!;getDb().prepare("UPDATE mcp_oauth_codes SET code_challenge_method='plain',code_challenge=?").run(VERIFIER);const r=await form('/token',new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,client_secret:client.client_secret,code,code_verifier:VERIFIER,redirect_uri:URI}));expect(r.status).toBe(400);expect(getDb().prepare('SELECT used_at FROM mcp_oauth_codes').get()).toEqual({used_at:null})});
 it('échappe les champs dans le HTML et conserve un état vide',async()=>{getDb().prepare('UPDATE mcp_clients SET name=?').run('<script>fictif</script>\u202e');const r=await authorize({state:'"<img src=x>'});const html=await r.text();expect(html).not.toContain('<script>');expect(html).not.toContain('\u202e');expect(html).not.toContain('<img src=x>');const empty=await decide({state:''});expect(new URL(empty.headers.get('location')!).searchParams.get('state')).toBe('')});

 it('ne crée pas de state dans le formulaire si le GET n’en avait pas',async()=>{const q=new URLSearchParams(fields());q.delete('state');const r=await app.request('/mcp/oauth/authorize?'+q);expect(r.status).toBe(200);expect(await r.text()).not.toContain('name="state"');q.set('decision','allow');const response=await form('/authorize/decision',q);expect(new URL(response.headers.get('location')!).searchParams.has('state')).toBe(false)});
 it('conserve les octets de la query enregistrée',async()=>{const uri='https://client.example.test/cb?libelle=deux%20mots&flag';expect((await form('/redirect-uris',new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,redirect_uris:JSON.stringify([uri])}))).status).toBe(200);const r=await decide({redirect_uri:uri});expect(r.headers.get('location')).toMatch(/^https:\/\/client\.example\.test\/cb\?libelle=deux%20mots&flag&code=/)});
 it('la CSP permet seulement l’origine de retour validée en plus du formulaire local',async()=>{const r=await authorize();expect(r.headers.get('content-security-policy')).toContain("form-action 'self' https://client.example.test;");const bad=await authorize({redirect_uri:'https://autre.example.test/cb'});expect(bad.headers.get('content-security-policy')).not.toContain('autre.example.test')});
 it('les clés étrangères sont actives et la suppression fictive du client retire sa configuration',()=>{const db=getDb();expect(db.pragma('foreign_keys',{simple:true})).toBe(1);db.prepare('DELETE FROM mcp_clients WHERE client_id=?').run(client.client_id);expect(db.prepare('SELECT COUNT(*) n FROM mcp_client_redirect_uris').get()).toEqual({n:0})});
 it('une liste JSON illisible conserve la configuration',async()=>{const r=await form('/redirect-uris',new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,redirect_uris:'['}));expect(r.status).toBe(400);expect(getDb().prepare('SELECT redirect_uri FROM mcp_client_redirect_uris').all()).toEqual([{redirect_uri:URI}])});

 it.each(['decision','configuration'])('un verrou concurrent rend un refus rapide et réversible : %s',async kind=>{const db=getDb(),other=new Database(join(folder,'fictive.sqlite'));other.exec('BEGIN IMMEDIATE');const run=()=>kind==='decision'?decide():form('/redirect-uris',new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,redirect_uris:JSON.stringify([URI])}));try{const start=performance.now(),r=await run();expect(r.status).toBe(503);expect(performance.now()-start).toBeLessThan(500);expect(await r.json()).toEqual({error:'temporarily_unavailable'});expect(db.pragma('busy_timeout',{simple:true})).toBe(5000)}finally{other.exec('ROLLBACK');other.close()}expect((await run()).status).toBe(kind==='decision'?302:200)});

});
