import { francAll } from 'franc-min';
import { getDb } from './db.js';
import { parseLocale, type Locale } from './email.js';
import { isLanguage, languageName } from './languages.js';

const iso: Record<string, string> = { fra:'fr',eng:'en',deu:'de',ita:'it',spa:'es',por:'pt',nld:'nl',arb:'ar',cmn:'zh',jpn:'ja',kor:'ko',rus:'ru',ukr:'uk',pol:'pl',ron:'ro',ces:'cs',slk:'sk',swe:'sv',dan:'da',nob:'no',nno:'no',fin:'fi',ell:'el',tur:'tr',hin:'hi',ben:'bn',tam:'ta',vie:'vi',tha:'th',ind:'id',zlm:'ms',heb:'he',pes:'fa',urd:'ur',swh:'sw',afr:'af',als:'sq',amh:'am',azj:'az',bel:'be',bul:'bg',cat:'ca',est:'et',glg:'gl',guj:'gu',hau:'ha',hrv:'hr',hun:'hu',hye:'hy',ibo:'ig',jav:'jv',kat:'ka',kaz:'kk',khm:'km',kan:'kn',lao:'lo',lit:'lt',lvs:'lv',mkd:'mk',mal:'ml',mar:'mr',mya:'my',npi:'ne',pan:'pa',pbu:'ps',sin:'si',slv:'sl',som:'so',srp:'sr',sun:'su',tgl:'tl',uzn:'uz',yor:'yo',zul:'zu' };

/** Le nouveau texte seul : une citation de notre ancien mail ne prouve pas la langue du client. */
export function currentMessage(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const result: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*(?:De|From|Von|Da)\s*:/i.test(line) && lines.slice(index + 1, index + 5).some(s => /^\s*(?:Envoyé|Sent|Gesendet|Inviato)\s*:/i.test(s))) break;
    if (/^\s*(?:On .{3,180}wrote:|Le .{3,180}écrit\s*:|Am .{3,180}schrieb|Il .{3,180}scritto:|El .{3,180}escribió:|[-_]{3,}\s*(?:Original|Message|Forwarded)|Begin forwarded message:|Début du message transféré)/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    result.push(line);
  }
  return result.join('\n').trim();
}
export function detectLanguage(text: string) {
  const sample = currentMessage(text).split(/\n\s*--\s*\n/)[0].replace(/https?:\/\/\S+|\b\S+@\S+\b/g, '').slice(0, 2400);
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  const results = letters >= 45 ? francAll(sample, { minLength: 45 }) : [];
  const code = iso[results[0]?.[0]];
  const margin = results.length > 1 ? results[0][1] - results[1][1] : 0;
  const certainEnough = isLanguage(code) && margin >= 0.10;
  return { code: certainEnough ? code : null, label: certainEnough ? languageName(code) : 'Langue à confirmer', source: 'detection', confidence: certainEnough ? 'probable' : 'uncertain' };
}
export type CustomerLanguage = { code: string | null; label: string; source: 'unknown' | 'manual' | 'checkout'; transactional_code: Locale; updated_at: number | null };
export function customerLanguage(customerId: number, legacyLocale: unknown): CustomerLanguage {
  const row = getDb().prepare('SELECT code,source,updated_at FROM crm_languages WHERE customer_id=?').get(customerId) as { code:string;source:'manual'|'checkout';updated_at:number } | undefined;
  return { code: row?.code ?? null, label: languageName(row?.code), source: row?.source ?? 'unknown', transactional_code: parseLocale(legacyLocale), updated_at: row?.updated_at ?? null };
}
export function setCustomerLanguage(id: number, code: string | null, source: 'manual' | 'checkout' = 'manual'): void {
  const db = getDb();
  db.transaction(() => {
    if (code === null) { db.prepare('DELETE FROM crm_languages WHERE customer_id=?').run(id); return; }
    if (!isLanguage(code)) throw new Error('invalid_language');
    db.prepare('INSERT INTO crm_languages(customer_id,code,source,updated_at) VALUES(?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET code=excluded.code,source=excluded.source,updated_at=excluded.updated_at').run(id, code, source, Date.now());
    // Les modèles transactionnels existent en FR/EN/DE. Autres langues : repli anglais annoncé dans le CRM.
    db.prepare('UPDATE customers SET locale=? WHERE id=?').run(['fr','en','de'].includes(code) ? code : 'en', id);
  })();
}
export function checkoutLanguage(id: number, value: unknown): Locale {
  const db = getDb();
  const row = db.prepare('SELECT locale FROM customers WHERE id=?').get(id) as {locale:string};
  try {
    const language = customerLanguage(id, row.locale);
    // La préférence enregistrée dans le CRM prime sur une page d’achat visitée dans une autre langue.
    if (language.source !== 'manual' && ['fr','en','de'].includes(String(value))) setCustomerLanguage(id, String(value), 'checkout');
    return parseLocale((db.prepare('SELECT locale FROM customers WHERE id=?').get(id) as {locale:string}).locale);
  } catch {
    // Une panne du suivi commercial ne doit pas bloquer la livraison d’un achat payé.
    console.warn('[langue] Suivi de préférence indisponible ; langue transactionnelle existante conservée.');
    return parseLocale(row.locale);
  }
}
