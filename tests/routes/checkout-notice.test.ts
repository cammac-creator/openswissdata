import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { checkoutRefusal } from '../../src/lib/checkout-notice.js';

describe('Avis Checkout accessibles sans script',()=>{
  afterEach(()=>vi.unstubAllEnvs());
  const request=(status:400|413|429|503,headers:Record<string,string>={},path='start')=>{
    vi.stubEnv('BASE_URL','https://site.example.test');const app=new Hono();app.post('/api/checkout/'+path,c=>{c.header('cache-control','no-store');if(status===429)c.header('retry-after','6');return checkoutRefusal(c,'refus_fictif',status)});
    return app.request('/api/checkout/'+path,{method:'POST',headers:{accept:'text/html',...headers}});
  };
  it.each([['fr','Vérifiez votre demande'],['de','Bitte prüfen Sie Ihre Anfrage'],['en','Please check your request']])('garde la langue de la fiche %s avant celle du navigateur',async(lang,title)=>{
    const r=await request(400,{referer:'https://site.example.test'+(lang==='fr'?'':'/'+lang)+'/datasets/finma','accept-language':'en,de;q=0.8'}),body=await r.text();
    expect(r.status).toBe(400);expect(body).toContain(`<html lang="${lang}">`);expect(body).toContain(title);expect(body).toContain(`href="${lang==='fr'?'':'/'+lang}/bundle"`);expect(body).not.toContain('<script');
  });
  it.each([[429,'Patientez quelques secondes'],[503,'Paiement momentanément indisponible'],[413,'Cette demande est trop volumineuse']] as const)('garde le statut %s et ferme les injections de contenu',async(status,title)=>{
    const r=await request(status,{referer:'https://tiers.example.test/de/<script>','accept-language':'fr'});const body=await r.text();expect(r.status).toBe(status);expect(body).toContain(title);expect(body).not.toContain('tiers.example.test');expect(body).not.toContain('<script');
    expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");expect(r.headers.get('x-robots-tag')).toContain('noindex');if(status===429)expect(r.headers.get('retry-after')).toBe('6');
  });
  it.each([['de-CH;q=0.7,en;q=0.8,fr;q=0','en'],['it,de-CH;q=0.8,en;q=0.6','de'],['zz;q=1,en;q=0,fr;q=2','fr']])('respecte les langues acceptées et leur poids : %s',async(header,lang)=>{
    const r=await request(503,{'accept-language':header});expect(await r.text()).toContain(`<html lang="${lang}">`);
  });
  it.each([['session','text/html'],['start','application/json']])('conserve le JSON pour %s avec Accept=%s',async(path,accept)=>{
    const r=await request(429,{accept},path);expect(r.status).toBe(429);expect(await r.json()).toEqual({error:'refus_fictif'});
  });
});
