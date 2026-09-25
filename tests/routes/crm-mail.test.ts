import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
const mocks=vi.hoisted(()=>({search:vi.fn(),fetch:vi.fn(),fetchOne:vi.fn(),open:vi.fn(),bronze:vi.fn()}));
vi.mock('imapflow',()=>({ImapFlow:class {
 on(){} async connect(){} close(){}
 async list(){return [{path:'INBOX'}]}
 async mailboxOpen(path:string,options:unknown){mocks.open(path,options);return {uidValidity:1n}}
 async search(query:unknown){return mocks.search(query)}
 async *fetch(ids:number[]){mocks.fetch(ids);for(const uid of ids)yield {uid,headers:Buffer.from('Subject: OpenSwissData\r\n'),envelope:{subject:'OpenSwissData',from:[{address:'contact@openswissdata.com'}]},internalDate:new Date(),flags:new Set()}}
 async fetchOne(uid:string){mocks.fetchOne(uid);return {size:80,source:Buffer.from('From: support@example.test\r\nSubject: OpenSwissData\r\n\r\nMessage de test')}}
}}));
vi.mock('../../src/lib/crm-source.js',async original=>({...await original<typeof import('../../src/lib/crm-source.js')>(),bronze:mocks.bronze}));
import { crmMailRoute } from '../../src/routes/crm-mail.js';
import { getDb,closeDb } from '../../src/lib/db.js';
import { seal,unseal,clearCrmCache } from '../../src/lib/crm-source.js';
describe('Périmètre de la messagerie personnelle',()=>{
 let temp:string;const app=new Hono().route('/mail',crmMailRoute);
 const encoded=(uid:number)=>Buffer.from(JSON.stringify({account:'cam_project',folder:'INBOX',uid,validity:'1'})).toString('base64url');
 const save=(name:string,user:string)=>getDb().prepare('INSERT INTO crm_connections VALUES(?,?,?)').run(name,seal(JSON.stringify({user,pass:'secret-fictif'})),Date.now());
 beforeEach(()=>{temp=mkdtempSync(join(tmpdir(),'osd-mail-'));process.env.DATABASE_PATH=join(temp,'test.sqlite');process.env.OSD_BACKUP_KEY='b'.repeat(64);process.env.CRM_PROJECT_MAILBOX='owner@example.test';delete process.env.RESEND_API_KEY;vi.clearAllMocks();clearCrmCache();mocks.search.mockImplementation((q:{uid?:string;or?:unknown[]})=>q.uid?(q.uid==='42'?[42]:[]):q.or?[42]:[42,99]);save('cam_project','owner@example.test')});
 afterEach(()=>{closeDb();rmSync(temp,{recursive:true,force:true});delete process.env.DATABASE_PATH;delete process.env.OSD_BACKUP_KEY;delete process.env.CRM_PROJECT_MAILBOX;clearCrmCache()});
 it('cherche le projet sur le serveur avant de charger les en-têtes personnels',async()=>{const response=await app.request('/mail');const body=await response.json();expect(response.status).toBe(200);expect(body.items).toHaveLength(1);expect(body.items[0].mailbox).toBe('owner@example.test');expect(mocks.search.mock.calls[0][0]).toMatchObject({since:expect.any(Date),or:expect.arrayContaining([{subject:'openswissdata'},{body:'openswissdata'}])});expect(mocks.fetch).toHaveBeenCalledWith([42]);expect(mocks.open).toHaveBeenCalledWith('INBOX',{readOnly:true});expect(JSON.stringify(body)).not.toContain('secret-fictif')});
 it('refuse un identifiant hors projet avant lecture du corps ou archivage',async()=>{const response=await app.request('/mail/imap/'+encoded(99));expect(response.status).toBe(502);expect(mocks.search.mock.calls[0][0]).toMatchObject({uid:'99',or:expect.any(Array)});expect(mocks.fetchOne).not.toHaveBeenCalled();expect(mocks.bronze).not.toHaveBeenCalled()});
 it('autorise le corps lié au projet après vérification du filtre',async()=>{const response=await app.request('/mail/imap/'+encoded(42));expect(response.status).toBe(200);expect((await response.json()).text.trim()).toBe('Message de test');expect(mocks.fetchOne).toHaveBeenCalledWith('42');expect(mocks.bronze).toHaveBeenCalledTimes(1)});
 it('refuse une étiquette support associée aux identifiants personnels',async()=>{save('support','owner@example.test');const body=await(await app.request('/mail')).json();expect(body.incoming.accounts.find((a:{id:string})=>a.id==='support').available).toBe(false);expect(mocks.fetch).toHaveBeenCalledTimes(1)});
 it('exige une confirmation spécifique avant de conserver un accès personnel',async()=>{expect((await app.request('/mail/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'owner@example.test',pass:'fictif'})})).status).toBe(400)});
 it('efface uniquement les copies temporaires de la boîte déconnectée',async()=>{const folder=join(temp,'bronze/dashboard/2026-09-25');mkdirSync(folder,{recursive:true});const personal=join(folder,'imap-cam_project-message-test.enc'),support=join(folder,'imap-support-message-test.enc');writeFileSync(personal,'copie fictive');writeFileSync(support,'autre copie fictive');const r=await app.request('/mail/disconnect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'owner@example.test'})});expect(r.status).toBe(200);expect(existsSync(personal)).toBe(false);expect(existsSync(support)).toBe(true)});
 it('connecte les deux boîtes séparément et déconnecte uniquement la boîte désignée',async()=>{save('support','contact@openswissdata.com');const response=await app.request('/mail/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'owner@example.test',pass:'nouveau-secret-fictif',personal_scope_ack:true})});expect(response.status).toBe(200);const saved=getDb().prepare('SELECT secret_encrypted FROM crm_connections WHERE name=?').get('cam_project') as {secret_encrypted:string};expect(saved.secret_encrypted).not.toContain('nouveau-secret');expect(JSON.parse(unseal(saved.secret_encrypted)).user).toBe('owner@example.test');expect((await app.request('/mail/disconnect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'owner@example.test'})})).status).toBe(200);expect(getDb().prepare('SELECT name FROM crm_connections').all()).toEqual([{name:'support'}])});
});
