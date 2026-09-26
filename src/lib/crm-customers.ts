import type Database from 'better-sqlite3';
import { getDb } from './db.js';
import { customerLanguage } from './crm-language.js';

export const CUSTOMER_PAGE_SIZE=50;
export const emailKey=(value:unknown)=>String(value??'').normalize('NFC').toLowerCase();
export const internalEmails=()=>[...new Set(`${process.env.ADMIN_EMAILS??''},${process.env.CRM_INTERNAL_EMAILS??''}`.split(',').map(s=>emailKey(s.trim())).filter(Boolean))];
const profileSql=`SELECT c.id,c.email,c.locale,c.created_at,COALESCE(p.display_name,'') display_name,COALESCE(p.company,'') company,COALESCE(p.stage,'nouveau') stage,COALESCE(p.internal,0) internal,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status='paid' AND o.stripe_session_id GLOB 'cs_live_*') paid_orders,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.stripe_session_id GLOB 'cs_test_*') test_orders,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.stripe_session_id GLOB 'cs_live_*') live_orders,
    (SELECT COALESCE(SUM(amount_chf-refunded_chf),0) FROM orders o WHERE o.customer_id=c.id AND o.status='paid' AND o.stripe_session_id GLOB 'cs_live_*') revenue_cents,
    (SELECT MAX(created_at) FROM orders o WHERE o.customer_id=c.id) last_order_at,
    (SELECT MAX(created_at) FROM sessions s WHERE s.customer_id=c.id AND s.expires_at-s.created_at > 86400000) last_login_at,
    (SELECT COUNT(*) FROM crm_tasks t WHERE t.customer_id=c.id AND t.done_at IS NULL) open_tasks
    FROM customers c LEFT JOIN crm_profiles p ON p.customer_id=c.id`;
type ProfileRow=Record<string,unknown>&{id:number;email:string;internal:number;test_orders:number;live_orders:number};
function present(rows:ProfileRow[]){const owners=internalEmails();return rows.map(r=>({...r,language:customerLanguage(r.id,r.locale),internal:Boolean(r.internal||owners.includes(emailKey(r.email))||(r.test_orders>0&&r.live_orders===0))}))}
export function customerProfiles(id?:number){
 const rows=getDb().prepare(`${profileSql} ${id?'WHERE c.id=?':''} ORDER BY last_order_at DESC,c.created_at DESC,c.id DESC LIMIT 1000`).all(...(id?[id]:[])) as ProfileRow[];
 return present(rows);
}
const prepared=new WeakSet<Database.Database>();
export const searchText=(value:unknown)=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().toLowerCase().replace(/ß/g,'ss');
export function prepareCustomerFunctions(db:Database.Database){
 if(prepared.has(db))return;
 db.function('crm_search_text',{deterministic:true},searchText);
 // Une adresse avec accent reste distincte d’une adresse sans accent.
 db.function('crm_email_key',{deterministic:true},emailKey);prepared.add(db);
}
export function customerPage(input:{q:string;page:number;include_internal:boolean}){
 const db=getDb();
 prepareCustomerFunctions(db);
 const owners=internalEmails(),conditions:string[]=[],params:Array<string|number>=[];
 if(!input.include_internal){conditions.push('internal=0 AND NOT (test_orders>0 AND live_orders=0)');if(owners.length){conditions.push(`crm_email_key(email) NOT IN (${owners.map(()=>'?').join(',')})`);params.push(...owners)}}
 if(input.q){conditions.push(`instr(crm_search_text(email||char(10)||display_name||char(10)||company||char(10)||CASE stage WHEN 'nouveau' THEN 'Nouveau' WHEN 'actif' THEN 'Actif' WHEN 'a_recontacter' THEN 'À recontacter' WHEN 'en_attente' THEN 'En attente' WHEN 'clos' THEN 'Clos' ELSE stage END),?)>0`);params.push(searchText(input.q))}
 const where=conditions.length?'WHERE '+conditions.join(' AND '):'';
 return db.transaction(()=>{
  const total=(db.prepare(`SELECT COUNT(*) total FROM (${profileSql}) ${where}`).get(...params) as {total:number}).total;
  const pages=Math.max(1,Math.ceil(total/CUSTOMER_PAGE_SIZE)),number=Math.min(input.page,pages),offset=(number-1)*CUSTOMER_PAGE_SIZE;
  const rows=db.prepare(`SELECT * FROM (${profileSql}) ${where} ORDER BY last_order_at DESC,created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params,CUSTOMER_PAGE_SIZE,offset) as ProfileRow[];
  return {checked_at:Date.now(),customers:present(rows),query:{q:input.q,include_internal:input.include_internal},page:{number,total_pages:pages,total,returned:rows.length,limit:CUSTOMER_PAGE_SIZE,has_previous:number>1,has_next:number<pages}};
 })();
}
