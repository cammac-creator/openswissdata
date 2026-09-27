import {beforeEach, afterEach, describe, it, expect, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {createApp} from '../../src/index.js';
import {getDb, closeDb} from '../../src/lib/db.js';
import {MAGIC_LINK_TTL_MS, SESSION_TTL_MS} from '../../src/lib/account-session.js';
import {LOGIN_CONFIRMATION_TTL_MS} from '../../src/lib/login-confirmation.js';

const ORIGIN='https://www.openswissdata.com', TOKEN='L'.repeat(43), SESSION='S'.repeat(43), NOW=1_790_530_000_000;
let now:number, folder:string, app:ReturnType<typeof createApp>;
type Preview = {confirmation:string; cookie:string; response:Response; html:string};
const rows=()=>getDb().prepare('SELECT * FROM sessions ORDER BY token').all();
function seedSession(customer=2, token=SESSION) {
  getDb().prepare("INSERT INTO sessions(token,customer_id,created_at,expires_at,purpose) VALUES(?,?,?,?,'session')").run(token,customer,NOW,NOW+SESSION_TTL_MS);
  return 'osd_session='+token;
}
async function preview(cookie='', extra=''): Promise<Preview> {
  const response=await app.request(ORIGIN+'/api/auth/verify?token='+TOKEN+extra,{headers:{cookie}});
  const html=await response.text();expect(response.status).toBe(200);
  const confirmation=/name="confirmation" value="([A-Za-z0-9_-]+)"/.exec(html)?.[1];expect(confirmation).toBeTruthy();
  return {confirmation:confirmation!,cookie:[cookie,response.headers.get('set-cookie')!.split(';')[0]].filter(Boolean).join('; '),response,html};
}
const post=(p:Preview,extra:Record<string,string>={},headers:Record<string,string>={})=>app.request(ORIGIN+'/api/auth/confirm',{
  method:'POST',headers:{origin:ORIGIN,cookie:p.cookie,'content-type':'application/x-www-form-urlencoded',...headers},
  body:new URLSearchParams({confirmation:p.confirmation,decision:'connect',...extra}).toString(),
});
async function denied(response:Response,status:number,before:unknown) {
  expect(response.status).toBe(status);expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(rows()).toEqual(before);
}
beforeEach(()=>{
  folder=mkdtempSync(join(tmpdir(),'osd-confirmation-'));now=NOW;
  vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));vi.stubEnv('BASE_URL',ORIGIN);vi.stubEnv('NODE_ENV','test');
  vi.stubEnv('SESSION_SECRET','cle-fictive-confirmation-de-connexion-50');vi.spyOn(Date,'now').mockImplementation(()=>now);
  const db=getDb();db.prepare("INSERT INTO customers(id,email,locale,created_at) VALUES(1,'alice@example.test','fr',?),(2,'autre@example.test','de',?)").run(NOW,NOW);
  db.prepare("INSERT INTO sessions(token,customer_id,created_at,expires_at,purpose) VALUES(?,1,?,?,'magic_link')").run(TOKEN,NOW,NOW+MAGIC_LINK_TTL_MS);
  app=createApp();
});
afterEach(()=>{closeDb();rmSync(folder,{recursive:true,force:true});vi.unstubAllEnvs();vi.restoreAllMocks();});

describe('La consultation ne connecte jamais',()=>{
  it.each(['GET','HEAD'])('%s répété laisse le lien, les sessions et les dates intacts',async method=>{
    const cookie=seedSession(),before=rows();
    for(let i=0;i<3;i++){
      const r=await app.request(ORIGIN+'/api/auth/verify?token='+TOKEN,{method,headers:{cookie}});
      expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toMatch(/^__Host-osd_login=/);expect(r.headers.get('set-cookie')).not.toMatch(/(?:^|, )osd_session=/);
      expect(rows()).toEqual(before);if(method==='HEAD')expect(await r.text()).toBe('');
    }
  });
  it('le cookie temporaire n’authentifie aucune route et ne contient aucune identité',async()=>{
    const p=await preview();expect(p.cookie).toMatch(/^__Host-osd_login=[A-Za-z0-9_-]{43}$/);
    for(const attribute of ['Secure','HttpOnly','SameSite=Lax','Path=/','Max-Age=300'])expect(p.response.headers.get('set-cookie')).toContain(attribute);
    expect(p.response.headers.get('set-cookie')).not.toContain('Domain=');
    expect((await app.request('/api/account',{headers:{cookie:p.cookie}})).status).toBe(401);
  });
  it('la page et sa CSP ne chargent ni script ni service extérieur, sans lien brut et avec une identité lisible',async()=>{
    const p=await preview(),style=/<style>([\s\S]*?)<\/style>/.exec(p.html)![1];
    expect(p.html).not.toContain(TOKEN);expect(p.html).toContain('<bdi id="target-account">alice@example.test</bdi>');
    expect(p.html).not.toMatch(/<script|src=|\son\w+=|https:\/\//);expect(p.html).toContain('alice@example.test');
    expect(p.response.headers.get('content-security-policy')).toBe(`default-src 'none'; style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    expect(p.response.headers.get('cache-control')).toBe('no-store');expect(p.response.headers.get('referrer-policy')).toBe('strict-origin');expect(p.html).toContain('name="referrer" content="strict-origin"');
    expect(p.html).toContain('action="/api/auth/confirm"');expect(p.html).not.toContain('action="/api/auth/verify');
  });
  it.each(['fr','de','en'])('confirmation puis compte dans la langue %s',async locale=>{
    getDb().prepare('UPDATE customers SET locale=? WHERE id=1').run(locale);const p=await preview();
    expect(p.html).toContain(`<html lang="${locale}">`);expect(p.html).not.toContain('switch-account');
    const r=await post(p);expect(r.status).toBe(303);expect(r.headers.get('location')).toBe((locale==='fr'?'':'/'+locale)+'/account?auth=ok');
    expect(r.headers.get('set-cookie')).toMatch(/^osd_session=[A-Za-z0-9_-]{43}/);expect(r.headers.get('set-cookie')).toContain('__Host-osd_login=;');
    expect(getDb().prepare('SELECT purpose FROM sessions').get()).toEqual({purpose:'session'});
  });
  it('échappe même une ancienne adresse mal formée',async()=>{
    getDb().prepare('UPDATE customers SET email=? WHERE id=1').run('"><script>alert(1)</script>@evil.test');
    const p=await preview();expect(p.html).not.toContain('<script>');expect(p.html).toContain('&quot;&gt;&lt;script&gt;');
  });
  it('les anciens liens passent aussi par confirmation et gardent seulement leur cible interne',async()=>{
    getDb().prepare("UPDATE sessions SET purpose='legacy'").run();const before=rows(),p=await preview('','&return_to=admin');expect(rows()).toEqual(before);
    const r=await post(p);expect(r.status).toBe(303);expect(r.headers.get('location')).toBe('/admin');
  });
  it('un hôte différent ne prépare aucune confirmation',async()=>{
    const before=rows();await denied(await app.request('https://autre.example.test/api/auth/verify?token='+TOKEN),400,before);
  });
});

describe('La décision reste liée à son navigateur et à la demande',()=>{
  it.each(['https://evil.example.test','https://mcp.openswissdata.com','null','',ORIGIN+', https://evil.test'])('refuse l’origine %s',async origin=>{
    const p=await preview(),before=rows();await denied(await post(p,{}, {origin}),403,before);
  });
  it('refuse une origine absente sans utiliser Referer comme remplacement',async()=>{
    const p=await preview(),before=rows();const r=await app.request(ORIGIN+'/api/auth/confirm',{method:'POST',headers:{referer:ORIGIN+'/api/auth/verify',cookie:p.cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({confirmation:p.confirmation,decision:'connect'}).toString()});await denied(r,403,before);
  });
  it.each(['cross-site','same-site'])('refuse un contexte Fetch Metadata %s',async site=>{
    const p=await preview(),before=rows();await denied(await post(p,{}, {'sec-fetch-site':site}),403,before);
  });
  it('accepte un vrai POST same-origin',async()=>{const p=await preview();expect((await post(p,{}, {'sec-fetch-site':'same-origin'})).status).toBe(303);});
  it('refuse un Host forgé même avec l’origine attendue',async()=>{const p=await preview(),before=rows();await denied(await post(p,{}, {host:'autre.example.test'}),403,before);});
  it('le routeur du sous-domaine MCP ne donne aucun accès à la confirmation',async()=>{
    const p=await preview(),before=rows(),r=await post(p,{}, {host:'mcp.openswissdata.com'});
    expect(r.status).toBe(404);expect(r.headers.get('set-cookie')).toBeNull();expect(rows()).toEqual(before);
  });
  it.each(['', '__Host-osd_login='+'B'.repeat(43)])('le formulaire volé sans son cookie ne suffit pas',async cookie=>{
    const p=await preview(),before=rows();await denied(await post(p,{}, {cookie}),403,before);
  });
  it('refuse les doublons et suffixes du cookie de confirmation',async()=>{
    const p=await preview(),before=rows();for(const cookie of [p.cookie+'x',p.cookie+'; '+p.cookie,p.cookie+'; __Host-osd_login=bad',p.cookie+'; __Host-osd_login'])await denied(await post(p,{}, {cookie}),403,before);
  });
  it('refuse une enveloppe altérée et une clé remplacée sans consommer le lien',async()=>{
    const p=await preview(),before=rows(),changed=(p.confirmation[0]==='A'?'B':'A')+p.confirmation.slice(1);
    await denied(await post(p,{confirmation:changed}),403,before);vi.stubEnv('SESSION_SECRET','autre-cle-fictive-confirmation-de-connexion-50');await denied(await post(p),403,before);
  });
  it.each([['decision','cancel'],['token',TOKEN],['target','admin'],['confirmation',''],['switch_account','yes']])('refuse un champ invalide %s',async(key,value)=>{
    const p=await preview(),before=rows();await denied(await post(p,{[key]:value}),key==='confirmation'||key==='switch_account'?403:400,before);
  });
  it.each(['confirmation','decision','switch_account'])('refuse le paramètre répété %s',async key=>{
    const p=await preview(),before=rows();const body=new URLSearchParams({confirmation:p.confirmation,decision:'connect'});if(key==='switch_account')body.append(key,'yes');body.append(key,key==='confirmation'?p.confirmation:'connect');
    const r=await app.request(ORIGIN+'/api/auth/confirm',{method:'POST',headers:{origin:ORIGIN,cookie:p.cookie,'content-type':'application/x-www-form-urlencoded'},body:body.toString()});await denied(r,400,before);
  });
  it('le jeton du mail brut ne remplace pas la confirmation',async()=>{const p=await preview(),before=rows();await denied(await post(p,{confirmation:TOKEN}),403,before);});
  it('refuse JSON, query ajoutée et formulaire mal encodé',async()=>{
    const p=await preview(),before=rows();await denied(await post(p,{}, {'content-type':'application/json'}),400,before);
    for(const [path,body] of [['/api/auth/confirm?target=admin',new URLSearchParams({confirmation:p.confirmation,decision:'connect'}).toString()],['/api/auth/confirm','confirmation=%XX&decision=connect']]){
      await denied(await app.request(ORIGIN+path,{method:'POST',headers:{origin:ORIGIN,cookie:p.cookie,'content-type':'application/x-www-form-urlencoded'},body}),400,before);
    }
  });
  it('borne un flux sans Content-Length et refuse avant toute écriture',async()=>{
    const p=await preview(),before=rows(),bytes=new TextEncoder().encode('confirmation='+p.confirmation+'&decision=connect&x='+'a'.repeat(5000));
    const body=new ReadableStream({start(c){c.enqueue(bytes.subarray(0,3000));c.enqueue(bytes.subarray(3000));c.close();}});
    const request=new Request(ORIGIN+'/api/auth/confirm',{method:'POST',headers:{origin:ORIGIN,cookie:p.cookie,'content-type':'application/x-www-form-urlencoded'},body,duplex:'half'} as RequestInit);
    expect(request.headers.has('content-length')).toBe(false);await denied(await app.fetch(request),413,before);
  });
});

describe('Date, changement de compte et pannes',()=>{
  it('la confirmation expire à la frontière exacte sans prolonger le lien ; nouvelle ouverture possible',async()=>{
    const p=await preview(),before=rows();now+=LOGIN_CONFIRMATION_TTL_MS;await denied(await post(p),403,before);
    const second=await preview();expect((await post(second)).status).toBe(303);
  });
  it('un lien proche de son expiration n’obtient pas cinq minutes de plus',async()=>{
    getDb().prepare('UPDATE sessions SET expires_at=?').run(NOW+10_000);const p=await preview(),before=rows();now+=10_000;await denied(await post(p),403,before);
  });
  it('un recul d’horloge ferme la confirmation',async()=>{const p=await preview(),before=rows();now--;await denied(await post(p),403,before);});
  it('le changement de compte demande une case dédiée ; le simple GET conserve le compte courant',async()=>{
    const cookie=seedSession(),before=rows(),p=await preview(cookie);expect(p.html).toContain('id="switch-account"');expect(p.html).toContain('remplacera le compte');expect(p.html).toContain('autre@example.test');
    await denied(await post(p),403,before);const r=await post(p,{switch_account:'yes'});expect(r.status).toBe(303);
    const c=r.headers.get('set-cookie')!.split(';')[0],me=await app.request('/api/account',{headers:{cookie:c}});expect((await me.json()).customer.id).toBe(1);
  });
  it('le même compte peut renouveler sa connexion sans avertissement de changement',async()=>{
    const p=await preview(seedSession(1));expect(p.html).not.toContain('id="switch-account"');expect((await post(p)).status).toBe(303);
  });
  it('une autre session ouverte entre affichage et clic impose une nouvelle vérification',async()=>{
    const p=await preview(),cookie=seedSession(),before=rows();const r=await post(p,{}, {cookie:p.cookie+'; '+cookie});await denied(r,409,before);expect(await r.text()).toContain('connexion a changé');
  });
  it('une session fermée entre affichage et clic impose aussi une nouvelle vérification',async()=>{
    const p=await preview(seedSession(1));getDb().prepare('DELETE FROM sessions WHERE token=?').run(SESSION);const before=rows();await denied(await post(p),409,before);
  });
  it('aucune session ouverte si la dernière écriture est ignorée ; le même formulaire reprend après panne',async()=>{
    const p=await preview(),before=rows();getDb().exec("CREATE TRIGGER panne_fictive BEFORE INSERT ON sessions WHEN NEW.purpose='session' BEGIN SELECT RAISE(IGNORE); END");
    const r=await post(p);await denied(r,503,before);expect(await r.text()).toContain('momentanément indisponible');getDb().exec('DROP TRIGGER panne_fictive');expect((await post(p)).status).toBe(303);
  });
  it('verrou interconnexion : refus rapide et formulaire conservé pour reprise',async()=>{
    const p=await preview(),before=rows(),db=new Database(join(folder,'fictive.sqlite'));db.exec('BEGIN IMMEDIATE');
    try{const start=performance.now();await denied(await post(p),503,before);expect(performance.now()-start).toBeLessThan(1000);expect(getDb().pragma('busy_timeout',{simple:true})).toBe(5000);}
    finally{db.exec('ROLLBACK');db.close();}expect((await post(p)).status).toBe(303);
  });
  it('le rejeu du formulaire ne crée pas une seconde session',async()=>{
    const p=await preview();expect((await post(p)).status).toBe(303);const before=rows();await denied(await post(p),410,before);
  });
  it('une configuration absente refuse sans cookie et laisse les sessions intactes',async()=>{
    const before=rows();vi.stubEnv('SESSION_SECRET','');const r=await app.request(ORIGIN+'/api/auth/verify?token='+TOKEN);await denied(r,503,before);expect(await r.text()).not.toContain('login_key_unavailable');
  });
});
