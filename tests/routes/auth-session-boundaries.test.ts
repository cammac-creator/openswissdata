import '../helpers/session-origin.js';
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {confirmEmailLink} from '../helpers/login.js';
const {send} = vi.hoisted(() => ({send: vi.fn().mockResolvedValue({sent:true})}));
vi.mock('../../src/lib/email.js', () => ({sendMagicLinkEmail:send, sendDownloadEmail:vi.fn(), parseLocale:(v:unknown)=>v==='de'||v==='en'?v:'fr'}));
import {createApp} from '../../src/index.js';
import {getDb,closeDb} from '../../src/lib/db.js';
import {MAGIC_LINK_TTL_MS,SESSION_TTL_MS,issueMagicLink} from '../../src/lib/account-session.js';

const NOW=1_790_522_000_000;
const TOKEN='A'.repeat(43);
let folder:string;
let app:ReturnType<typeof createApp>;
function seed(purpose='session', duration=SESSION_TTL_MS, token=TOKEN, expiry=NOW+duration) {
  getDb().prepare('INSERT INTO sessions(token,customer_id,created_at,expires_at,purpose) VALUES(?,1,?,?,?)').run(token,expiry-duration,expiry,purpose);
}
const verify=(token=TOKEN,extra='')=>confirmEmailLink(app,token,extra);
const rows=()=>getDb().prepare('SELECT * FROM sessions ORDER BY token').all();
const cookie=(value=TOKEN)=>({cookie:'__Host-osd_session='+value, origin:'https://www.openswissdata.com'});
const protectedPaths=['/api/account','/api/admin/stats'];

beforeEach(()=>{
 folder=mkdtempSync(join(tmpdir(),'osd-connexion-'));
 vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));vi.stubEnv('NODE_ENV','test');
 vi.stubEnv('ADMIN_EMAILS','owner@example.test');vi.stubEnv('BASE_URL','https://www.openswissdata.com');
 vi.stubEnv('SESSION_SECRET','cle-fictive-connexion-session-tests');
 vi.spyOn(Date,'now').mockReturnValue(NOW);send.mockReset().mockResolvedValue({sent:true});
 getDb().prepare("INSERT INTO customers(id,email,created_at) VALUES(1,'owner@example.test',?)").run(NOW);
 app=createApp();
});
afterEach(()=>{closeDb();rmSync(folder,{recursive:true,force:true});vi.unstubAllEnvs();vi.restoreAllMocks();});

describe('Frontières entre lien reçu et session ouverte',()=>{
 it.each(['magic_link','legacy'])('le lien %s ne sert jamais de cookie, compte ou administration',async kind=>{
  seed(kind,MAGIC_LINK_TTL_MS);const before=rows();
  for(const path of protectedPaths){const r=await app.request(path,{headers:cookie()});expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toContain('no-store');}
  expect(rows()).toEqual(before);const r=await verify();expect(r.status).toBe(303);expect(r.headers.get('set-cookie')).toBeTruthy();
 });
 it.each(['session','legacy'])('une session %s ne redevient pas un lien de connexion',async kind=>{
  seed(kind);const before=rows();const r=await verify();expect(r.headers.get('location')).toBe('/account?auth=expired');expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
  expect((await app.request('/api/account',{headers:cookie()})).status).toBe(200);
 });
 it('les durées historiques inconnues ne reçoivent pas un usage supposé',async()=>{
  seed('legacy',60000);const before=rows();expect((await app.request('/api/account',{headers:cookie()})).status).toBe(401);
  expect((await verify()).headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
 });
 it.each(['session','magic_link'])('expiration exacte exclusive pour %s',async kind=>{
  seed(kind,kind==='session'?SESSION_TTL_MS:MAGIC_LINK_TTL_MS,TOKEN,NOW);const before=rows();
  for(const path of protectedPaths)expect((await app.request(path,{headers:cookie()})).status).toBe(401);
  expect((await verify()).headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
 });
 it('un lien consommé ne se rejoue pas et le cookie résultant reste distinct',async()=>{
  seed('magic_link',MAGIC_LINK_TTL_MS);const r=await verify();const c=r.headers.get('set-cookie')!.split(';')[0];
  expect(c).not.toContain(TOKEN);expect((await verify()).headers.get('set-cookie')).toBeNull();
  expect((await app.request('/api/account',{headers:{cookie:c}})).status).toBe(200);
  expect(getDb().prepare('SELECT purpose,return_to FROM sessions').get()).toEqual({purpose:'session',return_to:'account'});
 });
 it.each([TOKEN+'x',TOKEN+'=',TOKEN.slice(0,-1),'"'+TOKEN+'"',TOKEN+'%00',TOKEN+',autre=x'])('refuse le cookie de forme ambiguë %s',async value=>{
  seed();for(const path of protectedPaths)expect((await app.request(path,{headers:cookie(value)})).status).toBe(401);
 });
 it.each(['__Host-osd_session='+TOKEN+'; __Host-osd_session='+TOKEN,'__Host-osd_session='+TOKEN+'; __Host-osd_session=bad',
  '__Host-osd_session=bad; __Host-osd_session='+TOKEN,'__Host-osd_session='+TOKEN+'; __Host-osd_session',
  '__Host-osd_session='+TOKEN+'; __Host-osd_session =bad'])('refuse les cookies répétés sans choisir un côté',async value=>{
  seed();const before=rows();for(const path of protectedPaths)expect((await app.request(path,{headers:{cookie:value}})).status).toBe(401);
  await app.request('https://www.openswissdata.com/api/auth/logout',{method:'POST',headers:{cookie:value,origin:'https://www.openswissdata.com'}});expect(rows()).toEqual(before);
 });
 it('accepte le cookie complet au milieu des autres cookies',async()=>{
  seed();expect((await app.request('/api/account',{headers:{cookie:'a=1; __Host-osd_session='+TOKEN+'; b=2'}})).status).toBe(200);
 });
 it('un cookie lien ne permet pas de supprimer le lien par logout',async()=>{
  seed('magic_link',MAGIC_LINK_TTL_MS);const before=rows();await app.request('https://www.openswissdata.com/api/auth/logout',{method:'POST',headers:cookie()});expect(rows()).toEqual(before);
 });
 it.each(['&token='+TOKEN,'&token=bad','&return_to=admin&return_to=account'])('refuse la query ambiguë sans consommer le lien',async extra=>{
  seed('magic_link',MAGIC_LINK_TTL_MS);const before=rows();const r=await verify(TOKEN,extra);expect(r.headers.get('location')).toBe('/account?auth=invalid');expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
 });
 it.each(['fr','de','en'])('retour du compte dans sa langue %s et en-têtes sans fuite',async locale=>{
  getDb().prepare('UPDATE customers SET locale=?').run(locale);seed('magic_link',MAGIC_LINK_TTL_MS);
  const r=await verify(TOKEN,'&return_to=admin');expect(r.headers.get('location')).toBe((locale==='fr'?'':'/'+locale)+'/account?auth=ok');
  expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('referrer-policy')).toBe('no-referrer');
 });
 it('le retour administrateur est enregistré dans le lien et ne peut pas être changé par la query',async()=>{
  const token=issueMagicLink(1,'admin');const r=await verify(token,'&return_to=https://example.test');expect(r.headers.get('location')).toBe('/admin');
 });
 it('un ancien lien administratif conserve uniquement le retour interne historique',async()=>{
  seed('legacy',MAGIC_LINK_TTL_MS);expect((await verify(TOKEN,'&return_to=admin')).headers.get('location')).toBe('/admin');
 });
 it('les liens non échangés ne gonflent pas le nombre de sessions ouvertes',async()=>{
  seed();seed('magic_link',MAGIC_LINK_TTL_MS,'B'.repeat(43));seed('legacy',MAGIC_LINK_TTL_MS,'C'.repeat(43));
  const r=await app.request('/api/admin/stats',{headers:cookie()});expect(r.status).toBe(200);
  const body=await r.json();expect(body.customers.active_sessions).toBe(1);
 });
 it('le cookie de production est sécurisé et seulement émis après échange',async()=>{
  vi.stubEnv('NODE_ENV','production');seed('magic_link',MAGIC_LINK_TTL_MS);const r=await verify();
  const c=r.headers.get('set-cookie')!;for(const v of ['HttpOnly','Secure','SameSite=Lax','Max-Age=2592000','Path=/'])expect(c).toContain(v);
 });
});

describe('Échange atomique et pannes de stockage',()=>{
 it('échec à la dernière écriture : lien intact, aucun cookie, reprise possible',async()=>{
  seed('magic_link',MAGIC_LINK_TTL_MS);const before=rows();
  getDb().exec("CREATE TRIGGER panne_fictive BEFORE INSERT ON sessions WHEN NEW.purpose='session' BEGIN SELECT RAISE(ABORT,'detail-prive-fictif'); END");
  const r=await verify();expect(r.status).toBe(503);expect(await r.text()).toContain('momentanément indisponible');expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
  getDb().exec('DROP TRIGGER panne_fictive');expect((await verify()).headers.get('set-cookie')).toBeTruthy();
 });
 it('échec de consommation : aucune deuxième session émise',async()=>{
  seed('magic_link',MAGIC_LINK_TTL_MS);const before=rows();getDb().exec("CREATE TRIGGER panne_fictive BEFORE DELETE ON sessions BEGIN SELECT RAISE(IGNORE); END");
  const r=await verify();expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
 });
 it('verrou concurrent : refus rapide, délai restauré et lien intact',async()=>{
  seed('magic_link',MAGIC_LINK_TTL_MS);const before=rows(),db=getDb(),other=new Database(join(folder,'fictive.sqlite'));other.exec('BEGIN IMMEDIATE');
  try{const start=performance.now();const r=await verify();expect(r.status).toBe(503);expect(r.headers.get('retry-after')).toBe('1');expect(performance.now()-start).toBeLessThan(1000);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);expect(db.pragma('busy_timeout',{simple:true})).toBe(5000);}
  finally{other.exec('ROLLBACK');other.close();}expect((await verify()).headers.get('set-cookie')).toBeTruthy();
 });
 it('deux échanges concurrents : un seul cookie émis',async()=>{
  seed('magic_link',MAGIC_LINK_TTL_MS);const replies=await Promise.all([verify(),verify()]);expect(replies.filter(r=>r.headers.has('set-cookie'))).toHaveLength(1);expect(rows()).toHaveLength(1);
 });
 it('un rollback SQLite global ne perd pas le lien',async()=>{
  seed('magic_link',MAGIC_LINK_TTL_MS);const before=rows();getDb().exec("CREATE TRIGGER panne_fictive BEFORE INSERT ON sessions BEGIN SELECT RAISE(ROLLBACK,'detail-prive-fictif'); END");
  expect((await verify()).status).toBe(503);expect(rows()).toEqual(before);expect(getDb().inTransaction).toBe(false);
 });
 it('une panne de déconnexion ne prétend pas révoquer le cookie',async()=>{
  seed();const before=rows();getDb().exec("CREATE TRIGGER panne_fictive BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'detail-prive-fictif'); END");
  const r=await app.request('https://www.openswissdata.com/api/auth/logout',{method:'POST',headers:cookie()});expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
 });
 it('une suppression ignorée ne prétend pas réussir la déconnexion',async()=>{
  seed();const before=rows();getDb().exec("CREATE TRIGGER panne_fictive BEFORE DELETE ON sessions BEGIN SELECT RAISE(IGNORE); END");
  const r=await app.request('https://www.openswissdata.com/api/auth/logout',{method:'POST',headers:cookie()});expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
 });
 it.each(['session','magic_link'])('refuse un jeton %s créé dans le futur',async kind=>{
  seed(kind,kind==='session'?SESSION_TTL_MS:MAGIC_LINK_TTL_MS,TOKEN,NOW+(kind==='session'?SESSION_TTL_MS:MAGIC_LINK_TTL_MS)+1);
  const before=rows();expect((await app.request('/api/account',{headers:cookie()})).status).toBe(401);
  expect((await verify()).headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
 });
 it('panne de lecture : accès fermé et diagnostic fixe sur les deux gardes',async()=>{
  getDb().exec('DROP TABLE sessions');for(const path of protectedPaths){const r=await app.request(path,{headers:cookie()});expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'temporarily_unavailable'});}
 });
 it('échec d’émission : aucun mail envoyé et aucune ligne partielle',async()=>{
  getDb().exec("CREATE TRIGGER panne_fictive BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'detail-prive-fictif'); END");
  const r=await app.request('/api/auth/magic-link',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@example.test'})});expect(r.status).toBe(503);expect(send).not.toHaveBeenCalled();expect(rows()).toHaveLength(0);
 });
 it('migration additive : lignes conservées, durées historiques contrôlées sans réécriture',async()=>{
  closeDb();const raw=new Database(join(folder,'fictive.sqlite'));
  raw.exec("DROP TABLE sessions; CREATE TABLE sessions(token TEXT PRIMARY KEY,customer_id INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,FOREIGN KEY(customer_id) REFERENCES customers(id))");
  raw.prepare('INSERT INTO sessions VALUES(?,1,?,?)').run(TOKEN,NOW+SESSION_TTL_MS,NOW);raw.close();
  const migrated=getDb().prepare('SELECT * FROM sessions').get() as Record<string,unknown>;
  expect(migrated).toEqual({token:TOKEN,customer_id:1,created_at:NOW,expires_at:NOW+SESSION_TTL_MS,purpose:'legacy',return_to:'account'});
  expect((await app.request('/api/account',{headers:cookie()})).status).toBe(200);closeDb();expect(getDb().prepare('SELECT * FROM sessions').get()).toEqual(migrated);
 });
});
