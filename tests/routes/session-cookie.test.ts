import {beforeEach, afterEach, describe, it, expect, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../src/index.js';
import {getDb, closeDb} from '../../src/lib/db.js';
import {SESSION_TTL_MS, MAGIC_LINK_TTL_MS, uniqueTokenCookie} from '../../src/lib/account-session.js';
import {SESSION_COOKIE, LOCAL_SESSION_COOKIE} from '../../src/lib/session-cookie.js';

const ORIGIN='https://www.openswissdata.com', NOW=1_790_530_000_000;
const OLD='S'.repeat(43), OTHER='D'.repeat(43), LINK='L'.repeat(43);
let folder:string, app:ReturnType<typeof createApp>;
const cookie=(token=OLD)=>`${SESSION_COOKIE}=${token}`;
const rows=()=>getDb().prepare('SELECT * FROM sessions ORDER BY token').all();
const present=(token:string)=>Boolean(getDb().prepare('SELECT 1 FROM sessions WHERE token=?').get(token));
function seedSession(token=OLD, customer=2, purpose='session'){
  getDb().prepare('INSERT INTO sessions(token,customer_id,created_at,expires_at,purpose) VALUES(?,?,?,?,?)')
    .run(token,customer,NOW,NOW+SESSION_TTL_MS,purpose);
}
async function preview(existing='', origin=ORIGIN){
  const response=await app.request(origin+'/api/auth/verify?token='+LINK,{headers:{cookie:existing}});
  const html=await response.text();expect(response.status).toBe(200);
  const confirmation=/name="confirmation" value="([A-Za-z0-9_-]+)"/.exec(html)![1];
  return {html,confirmation,cookie:[existing,response.headers.get('set-cookie')!.split(';')[0]].filter(Boolean).join('; ')};
}
const confirm=(p:Awaited<ReturnType<typeof preview>>, switchAccount=false, origin=ORIGIN)=>app.request(origin+'/api/auth/confirm',{
  method:'POST',headers:{cookie:p.cookie,origin,'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({confirmation:p.confirmation,decision:'connect',...(switchAccount?{switch_account:'yes'}:{})}).toString(),
});
const logout=(existing=cookie(), headers:Record<string,string>={})=>app.request(ORIGIN+'/api/auth/logout',{
  method:'POST',headers:{cookie:existing,origin:ORIGIN,...headers},
});
beforeEach(()=>{
  folder=mkdtempSync(join(tmpdir(),'osd-session-cookie-'));vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));
  vi.stubEnv('BASE_URL',ORIGIN);vi.stubEnv('NODE_ENV','test');vi.stubEnv('SESSION_SECRET','cle-fictive-sessions-protegees-du-lot51');
  vi.stubEnv('ADMIN_EMAILS','owner@example.test');vi.spyOn(Date,'now').mockReturnValue(NOW);
  const db=getDb();db.prepare("INSERT INTO customers(id,email,locale,created_at) VALUES(1,'alice@example.test','fr',?),(2,'owner@example.test','de',?)").run(NOW,NOW);
  db.prepare("INSERT INTO sessions(token,customer_id,created_at,expires_at,purpose) VALUES(?,1,?,?,'magic_link')").run(LINK,NOW,NOW+MAGIC_LINK_TTL_MS);
  app=createApp();
});
afterEach(()=>{closeDb();rmSync(folder,{recursive:true,force:true});vi.restoreAllMocks();vi.unstubAllEnvs();});

describe('Migration sans promotion de cookie historique',()=>{
  it.each(['\u00a0','\ufeff','\u2003'])('ne normalise pas le blanc Unicode %s en préfixe protégé',blank=>{
    expect(uniqueTokenCookie(blank+cookie(),SESSION_COOKIE)).toBeNull();
    expect(uniqueTokenCookie(cookie()+'; '+blank+cookie(OTHER),SESSION_COOKIE)).toBeNull();
    expect(uniqueTokenCookie(cookie()+blank,SESSION_COOKIE)).toBeNull();
  });
  it('accepte les blancs syntaxiques ASCII et refuse un nom protégé déguisé par sa casse',()=>{
    expect(uniqueTokenCookie(' \t'+SESSION_COOKIE+' \t='+OLD+' \t',SESSION_COOKIE)).toBe(OLD);
    expect(uniqueTokenCookie(cookie()+'; __host-osd_session='+OTHER,SESSION_COOKIE)).toBeNull();
  });
  it.each(['session','legacy'])('un ancien cookie de session %s ne donne plus accès et ne modifie pas la base',async purpose=>{
    seedSession(OLD,2,purpose);const before=rows();
    for(const path of ['/api/account','/api/admin/stats']){
      const r=await app.request(ORIGIN+path,{headers:{cookie:'osd_session='+OLD}});expect(r.status).toBe(401);expect(r.headers.get('set-cookie')).toBeNull();
    }
    expect(rows()).toEqual(before);
  });
  it('aucun repli vers le cookie historique si le nouveau est absent ou invalide',async()=>{
    seedSession();
    for(const value of ['osd_session='+OLD,'osd_session='+OLD+'; '+SESSION_COOKIE+'=bad',LOCAL_SESSION_COOKIE+'='+OLD]){
      expect((await app.request(ORIGIN+'/api/account',{headers:{cookie:value}})).status).toBe(401);
    }
  });
  it.each(['osd_session=bad','osd_session='+OTHER+'; osd_session='+OLD,'osd_session; osd_session='])('les anciens cookies ambigus ne bloquent pas une nouvelle session %s',async legacy=>{
    seedSession();expect((await app.request(ORIGIN+'/api/account',{headers:{cookie:legacy+'; '+cookie()}})).status).toBe(200);
  });
  it('le nouveau cookie répété est refusé malgré un ancien cookie valide',async()=>{
    seedSession();const before=rows();
    expect((await app.request(ORIGIN+'/api/account',{headers:{cookie:cookie()+'; '+cookie()+'; osd_session='+OLD}})).status).toBe(401);expect(rows()).toEqual(before);
  });
  it('le lien email existant permet de se reconnecter sans adopter les anciens cookies',async()=>{
    seedSession();const before=rows(),p=await preview('osd_session='+OLD+'; osd_session='+OTHER);
    expect(p.html).not.toContain('id="switch-account"');expect(p.html).not.toContain('owner@example.test');expect(rows()).toEqual(before);
    const r=await confirm(p);expect(r.status).toBe(303);const cookies=r.headers.getSetCookie();
    expect(cookies[0]).toMatch(/^__Host-osd_session=[A-Za-z0-9_-]{43};/);
    for(const attribute of ['Secure','HttpOnly','SameSite=Lax','Path=/','Max-Age=2592000'])expect(cookies[0]).toContain(attribute);
    expect(cookies.every(c=>!c.includes('Domain='))).toBe(true);
    expect(cookies.some(c=>c.startsWith('osd_session=;') && c.includes('Max-Age=0'))).toBe(true);
    expect(present(OLD)).toBe(true);expect(present(LINK)).toBe(false);
    expect((await app.request(ORIGIN+'/api/account',{headers:{cookie:cookies[0].split(';')[0]+'; osd_session='+OLD+'; osd_session='+OTHER}})).status).toBe(200);
  });
  it('ne modifie pas le cookie ou la session courante pendant un GET ou HEAD',async()=>{
    seedSession();const before=rows();
    for(const method of ['GET','HEAD']){
      const r=await app.request(ORIGIN+'/api/auth/verify?token='+LINK,{method,headers:{cookie:cookie()}});
      expect(r.status).toBe(200);expect(r.headers.getSetCookie().every(c=>c.startsWith('__Host-osd_login='))).toBe(true);expect(rows()).toEqual(before);
    }
  });
  it('le développement HTTP local utilise un nom séparé, jamais osd_session',async()=>{
    vi.stubEnv('BASE_URL','http://localhost:3000');const p=await preview('','http://localhost:3000');
    const r=await confirm(p,false,'http://localhost:3000');expect(r.status).toBe(303);const c=r.headers.getSetCookie()[0];
    expect(c).toMatch(/^osd_dev_session=/);expect(c).not.toContain('Secure');
    expect((await app.request('/api/account',{headers:{cookie:c.split(';')[0]}})).status).toBe(200);
    vi.stubEnv('BASE_URL',ORIGIN);expect((await app.request(ORIGIN+'/api/account',{headers:{cookie:c.split(';')[0]}})).status).toBe(401);
  });
  it.each(['http://www.openswissdata.com','http://localhost:3000','ftp://localhost:3000'])('en production une origine non HTTPS %s ferme les accès',async base=>{
    seedSession();vi.stubEnv('NODE_ENV','production');vi.stubEnv('BASE_URL',base);const before=rows();
    const r=await app.request(ORIGIN+'/api/account',{headers:{cookie:cookie()}});expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
  });
});

describe('Rotation et révocation de la seule session remplacée',()=>{
  it.each([1,2])('la reconnexion depuis le compte %i ferme l’ancienne session et conserve un autre appareil',async customer=>{
    seedSession(OLD,customer);seedSession(OTHER,customer);const p=await preview(cookie());
    expect(p.html.includes('id="switch-account"')).toBe(customer!==1);
    const r=await confirm(p,customer!==1);expect(r.status).toBe(303);expect(present(OLD)).toBe(false);expect(present(OTHER)).toBe(true);expect(present(LINK)).toBe(false);
    expect((await app.request(ORIGIN+'/api/account',{headers:{cookie:cookie()}})).status).toBe(401);
    expect((await app.request(ORIGIN+'/api/account',{headers:{cookie:cookie(OTHER)}})).status).toBe(200);
    const newCookie=r.headers.getSetCookie()[0].split(';')[0];expect(newCookie).not.toContain(OLD);
    const me=await app.request(ORIGIN+'/api/account',{headers:{cookie:newCookie}});expect((await me.json()).customer.id).toBe(1);
  });
  it.each(['IGNORE',"ABORT,'panne-fictive'"])('échec de suppression de la session remplacée %s : rollback du lien et reprise',async mode=>{
    seedSession();const p=await preview(cookie()),before=rows();
    getDb().exec(`CREATE TRIGGER panne_fictive BEFORE DELETE ON sessions WHEN OLD.token='${OLD}' BEGIN SELECT RAISE(${mode}); END`);
    const r=await confirm(p,true);expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
    getDb().exec('DROP TRIGGER panne_fictive');expect((await confirm(p,true)).status).toBe(303);expect(present(OLD)).toBe(false);
  });
  it.each(['IGNORE',"ABORT,'panne-fictive'"])('échec de dernière insertion %s restaure aussi la session remplacée',async mode=>{
    seedSession();const p=await preview(cookie()),before=rows();
    getDb().exec(`CREATE TRIGGER panne_fictive BEFORE INSERT ON sessions WHEN NEW.purpose='session' BEGIN SELECT RAISE(${mode}); END`);
    const r=await confirm(p,true);expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
    getDb().exec('DROP TRIGGER panne_fictive');expect((await confirm(p,true)).status).toBe(303);
  });
  it('un changement de session dans un autre onglet refuse la page devenue obsolète',async()=>{
    seedSession();seedSession(OTHER);const p=await preview(cookie()),before=rows();p.cookie=p.cookie.replace(cookie(),cookie(OTHER));
    expect((await confirm(p,true)).status).toBe(409);expect(rows()).toEqual(before);
  });
  it('injecter seulement un ancien cookie ne change pas le compte courant ni la session à révoquer',async()=>{
    seedSession();seedSession(OTHER);const p=await preview(cookie());p.cookie+='; osd_session='+OTHER;
    expect((await confirm(p,true)).status).toBe(303);expect(present(OLD)).toBe(false);expect(present(OTHER)).toBe(true);
  });
});

describe('Déconnexion liée à l’origine du site',()=>{
  it.each(['','null','https://mcp.openswissdata.com','https://evil.example.test'])('refuse l’origine %s sans révocation ni effacement',async origin=>{
    seedSession();const before=rows(),r=await logout(cookie(),{origin});expect(r.status).toBe(403);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
  });
  it('refuse aussi l’origine absente, même si Referer paraît correct',async()=>{
    seedSession();const before=rows();const r=await app.request(ORIGIN+'/api/auth/logout',{method:'POST',headers:{cookie:cookie(),referer:ORIGIN+'/account'}});
    expect(r.status).toBe(403);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
  });
  it.each(['same-site','cross-site'])('refuse le contexte %s même avec une origine déclarée correcte',async site=>{
    seedSession();const before=rows(),r=await logout(cookie(),{'sec-fetch-site':site});expect(r.status).toBe(403);expect(rows()).toEqual(before);
  });
  it('ferme la nouvelle session, nettoie le cookie historique et conserve les autres appareils',async()=>{
    seedSession();seedSession(OTHER);const r=await logout(cookie()+'; osd_session='+OTHER);expect(r.status).toBe(200);
    expect(present(OLD)).toBe(false);expect(present(OTHER)).toBe(true);
    const cookies=r.headers.getSetCookie();expect(cookies).toHaveLength(2);expect(cookies[0]).toMatch(/^__Host-osd_session=;/);
    expect(cookies.every(c=>c.includes('Secure') && c.includes('HttpOnly') && c.includes('Max-Age=0') && c.includes('Path=/') && !c.includes('Domain='))).toBe(true);
  });
  it('un ancien cookie seul n’autorise pas la révocation d’une ligne historique',async()=>{
    seedSession();const before=rows(),r=await logout('osd_session='+OLD);expect(r.status).toBe(200);expect(rows()).toEqual(before);
  });
});
