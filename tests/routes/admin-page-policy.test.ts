import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../src/index.js';
import {Hono} from 'hono';
import {adminPagePolicy} from '../../src/lib/admin-page-policy.js';

describe('Politique de scripts du fichier bureau',()=>{
 let root:string;
 beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'osd-csp-'));for(const path of ['admin','account','admin-autre']){mkdirSync(join(root,path));writeFileSync(join(root,path,'index.html'),'<html><body>'+path+'<script src="/_astro/fictif.js" type="module"></script></body></html>')}mkdirSync(join(root,'_astro'));writeFileSync(join(root,'_astro/fictif.js'),'window.fictif=true;')});
 afterEach(()=>rmSync(root,{recursive:true,force:true}));
 function directives(value:string|null){return Object.fromEntries(value!.split(';').map(s=>s.trim().split(/\s+/)).map(([key,...sources])=>[key,sources]))}
 it.each(['/admin','/admin/','/admin/index.html','/%61dmin/','/ad%6Din/index.html','/admin/index%2ehtml','/admin?test=fictif'])('durcit le contenu réellement servi via %s',async(path)=>{
  const response=await createApp({webRoot:root}).request(path),d=directives(response.headers.get('content-security-policy'));
  expect(response.status).toBe(200);expect(await response.text()).toContain('<body>admin<script');
  expect(d['script-src']).toEqual(["'self'"]);expect(d['script-src-elem']).toEqual(["'self'"]);expect(d['script-src-attr']).toEqual(["'none'"]);expect(d['object-src']).toEqual(["'none'"]);expect(d['base-uri']).toEqual(["'none'"]);
  expect(d['style-src']).toContain("'unsafe-inline'");expect(d['frame-ancestors']).toEqual(["'none'"]);expect(d['form-action']).toEqual(["'self'"]);expect(d['connect-src']).toEqual(["'self'"]);expect(d['img-src']).toEqual(["'self'",'data:']);expect(response.headers.get('x-frame-options')).toBe('DENY');
  expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
 });
 it.each(['HEAD','OPTIONS'])('applique aussi la politique à %s',async(method)=>{const r=await createApp({webRoot:root}).request('/admin',{method});expect(r.status).toBe(200);expect(directives(r.headers.get('content-security-policy'))['script-src']).toEqual(["'self'"])});
 it('protège aussi une réponse partielle du bureau',async()=>{const r=await createApp({webRoot:root}).request('/admin',{headers:{range:'bytes=0-30'}});expect(r.status).toBe(206);expect(directives(r.headers.get('content-security-policy'))['script-src']).toEqual(["'self'"]);await r.text()});
 it('préserve les politiques des pages compte et des téléchargements',async()=>{
  const app=createApp({webRoot:root});for(const path of ['/account','/admin-autre']){const r=await app.request(path);expect(r.status).toBe(200);expect(directives(r.headers.get('content-security-policy'))['script-src']).toContain("'unsafe-inline'");await r.text()}
  const r=await app.request('/api/delivery/invalide');const d=directives(r.headers.get('content-security-policy'));expect(d['default-src']).toEqual(["'none'"]);expect(d['base-uri']).toEqual(["'none'"]);expect(d['script-src']).toBeUndefined();
 });
 it('la marque ne fuit pas entre requêtes simultanées et les ressources restent servies',async()=>{
  const app=createApp({webRoot:root});const responses=await Promise.all(Array.from({length:20},(_,i)=>app.request(i%2?'/account':'/admin')));for(let i=0;i<responses.length;i++){const r=responses[i],sources=directives(r.headers.get('content-security-policy'))['script-src'];expect(sources.includes("'unsafe-inline'")).toBe(i%2===1);await r.text()}
  const r=await app.request('/_astro/fictif.js');expect(r.status).toBe(200);expect(await r.text()).toBe('window.fictif=true;');
 });
 it('un chemin non servi ne fait pas croire que le bureau a été protégé',async()=>{const r=await createApp({webRoot:root}).request('/admin/inexistant');expect(r.status).toBe(404);expect(await r.text()).not.toContain('<body>admin<script')});
 it.each([null,"default-src 'self', script-src 'unsafe-inline'"])('ne sert pas le bureau avec une politique générale absente ou multiple : %s',async(value)=>{
  const app=new Hono(),policy=adminPagePolicy(root);app.onError((error,c)=>c.json({error:error.message},500));app.use('*',policy.middleware);app.get('/',c=>{policy.onFound(join(root,'admin/index.html'),c);if(value)c.header('Content-Security-Policy',value);return c.html('<p>Bureau fictif à ne pas servir</p>')});
  const r=await app.request('/');expect(r.status).toBe(500);const body=await r.text();expect(body).toContain(value?'admin_csp_multiple':'admin_csp_missing');expect(body).not.toContain('Bureau fictif');
 });
 it.each(['/_astro/..%2fadmin%2findex.html','/samples/..%2fadmin%2findex.html'])('refuse la traversée via un autre montage statique : %s',async(path)=>{
  const r=await createApp({webRoot:root}).request(path);expect(r.status).toBe(404);expect(await r.text()).not.toContain('<body>admin<script');
 });

});
