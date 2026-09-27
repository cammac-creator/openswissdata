import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { checkoutRoute } from '../../src/routes/checkout.js';
import { createApp } from '../../src/index.js';
import { CHECKOUT_NOTICE_CSP } from '../../src/lib/checkout-notice.js';
const { create }=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('../../src/lib/stripe.js',()=>({stripe:()=>({checkout:{sessions:{create}}}),resetStripeClient:vi.fn()}));

const NOW=Date.UTC(2026,8,26,12);
describe('Demandes Checkout avec protection réelle et Stripe simulé',()=>{
  let folder:string;
  const app=()=>new Hono().route('/api/checkout',checkoutRoute);
  const request=(path='session',ip='192.0.2.1',extra:Record<string,string>={},body?:string)=>app().request('/api/checkout/'+path,{
    method:'POST',headers:{'content-type':path==='session'?'application/json':'application/x-www-form-urlencoded','x-real-ip':ip,...extra},
    body:body??(path==='session'?JSON.stringify({dataset_ids:['finma'],locale:'de'}):'dataset_ids=finma&locale=de'),
  });
  beforeEach(()=>{
    closeDb();folder=mkdtempSync(join(tmpdir(),'osd-checkout-routes-'));
    vi.stubEnv('DATABASE_PATH',join(folder,'fictive.sqlite'));vi.stubEnv('NODE_ENV','test');vi.stubEnv('RAILWAY_ENVIRONMENT_ID','fictif');
    vi.stubEnv('SESSION_SECRET','cle-fictive-stable-assez-longue');vi.stubEnv('BASE_URL','https://site.example.test');
    vi.spyOn(Date,'now').mockReturnValue(NOW);create.mockReset();create.mockResolvedValue({id:'cs_test_fictif',url:'https://checkout.stripe.com/fictif',livemode:false,mode:'payment'});
    getDb().prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('finma','FINMA','finma',29900,'price_fictif',?)").run(NOW);
  });
  afterEach(()=>{closeDb();vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(folder,{recursive:true,force:true})});
  it.each(['session','start'])('préserve la réussite %s et applique no-store',async path=>{
    const r=await request(path);expect(r.status).toBe(path==='session'?200:303);expect(r.headers.get('cache-control')).toBe('no-store');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({locale:'de',line_items:[{price:'price_fictif',quantity:1}],consent_collection:{terms_of_service:'required'}}));
    if(path==='session')expect(await r.json()).toEqual({session_id:'cs_test_fictif',url:'https://checkout.stripe.com/fictif'});else expect(r.headers.get('location')).toBe('https://checkout.stripe.com/fictif');
  });
  it.each([['session','start'],['start','session']])('partage les six secondes entre %s et %s puis autorise à la frontière',async(first,second)=>{
    await request(first);const r=await request(second);expect(r.status).toBe(429);expect(await r.json()).toEqual({error:'too_many_requests'});expect(r.headers.get('retry-after')).toBe('6');expect(r.headers.get('cache-control')).toBe('no-store');
    closeDb();vi.mocked(Date.now).mockReturnValue(NOW+5999);expect((await request(first)).headers.get('retry-after')).toBe('1');expect(create).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue(NOW+6000);expect((await request(second)).status).toBe(second==='session'?200:303);expect(create).toHaveBeenCalledTimes(2);
  });
  it('ignore les variations de X-Forwarded-For déclarées par l’appelant',async()=>{
    expect((await request('session','192.0.2.1',{'x-forwarded-for':'198.51.100.1'})).status).toBe(200);
    expect((await request('session','192.0.2.1',{'x-forwarded-for':'198.51.100.2'})).status).toBe(429);
    expect((await request('session','192.0.2.2',{'x-forwarded-for':'198.51.100.1'})).status).toBe(200);expect(create).toHaveBeenCalledTimes(2);
  });
  it.each([['2001:db8:1:2::1','2001:0DB8:0001:0002::2'],['::ffff:192.0.2.1','192.0.2.1'],['::ffff:c000:201','192.0.2.1'],['','invalide,192.0.2.2']])('regroupe les identités équivalentes ou invalides %s / %s',async(a,b)=>{
    expect((await request('session',a)).status).toBe(200);expect((await request('session',b)).status).toBe(429);expect(create).toHaveBeenCalledTimes(1);
  });
  it('ne croit aucun en-tête de proxy hors Railway',async()=>{
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID','');expect((await request('session','192.0.2.1')).status).toBe(200);expect((await request('session','192.0.2.2')).status).toBe(429);
  });
  it('n’accorde qu’une seule création lors de demandes simultanées',async()=>{
    const responses=await Promise.all(Array.from({length:12},()=>request()));expect(responses.filter(r=>r.status===200)).toHaveLength(1);expect(responses.filter(r=>r.status===429)).toHaveLength(11);expect(create).toHaveBeenCalledTimes(1);
  });
  it.each(['session','start'])('refuse un corps trop gros en %s, avec ou sans longueur annoncée',async path=>{
    for(const headers of [{},{'content-length':'5000'}]){
      const r=await request(path,'192.0.2.1',headers,'x'.repeat(5000));expect(r.status).toBe(413);expect(r.headers.get('cache-control')).toBe('no-store');expect(await r.json()).toEqual({error:'body_too_large'});
    }
    expect(create).not.toHaveBeenCalled();expect(getDb().prepare('SELECT COUNT(*) n FROM checkout_request_limits').get()).toEqual({n:0});
  });
  it('borne aussi un corps transmis en plusieurs morceaux avant tout appel Stripe',async()=>{
    const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(3000)));c.enqueue(new TextEncoder().encode('y'.repeat(1097)));c.close()}});
    const r=await app().request(new Request('https://site.example.test/api/checkout/session',{method:'POST',body:stream,duplex:'half',headers:{'content-type':'application/json','x-real-ip':'192.0.2.1'}} as RequestInit));
    expect(r.status).toBe(413);expect(create).not.toHaveBeenCalled();
  });
  it.each(['cle','table','horloge','ecriture'])('renvoie un refus prudent sans Stripe lorsque %s est indisponible',async cause=>{
    if(cause==='cle')vi.stubEnv('SESSION_SECRET','');
    if(cause==='table')getDb().exec('DROP TABLE checkout_request_limits');
    if(cause==='horloge')vi.mocked(Date.now).mockReturnValue(1);
    if(cause==='ecriture')getDb().exec("CREATE TRIGGER stop_checkout BEFORE INSERT ON checkout_request_limits BEGIN SELECT RAISE(ABORT,'erreur privée fictive'); END");
    const r=await request();expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'temporarily_unavailable'});expect(r.headers.get('cache-control')).toBe('no-store');expect(create).not.toHaveBeenCalled();
  });
  it('une erreur de contenu consomme le délai et ne se transforme pas en création',async()=>{
    const r=await request('session','192.0.2.1',{},'{');expect(r.status).toBe(400);expect(r.headers.get('cache-control')).toBe('no-store');expect((await request('start')).status).toBe(429);expect(create).not.toHaveBeenCalled();
  });
  it('garde le délai après une erreur Stripe sans deuxième tentative implicite',async()=>{
    create.mockRejectedValue(new Error('erreur fictive Stripe'));expect((await request()).status).toBe(502);expect((await request('start')).status).toBe(429);expect(create).toHaveBeenCalledTimes(1);
  });
  it('refuse proprement un formulaire multipart invalide',async()=>{
    const r=await request('start','192.0.2.1',{'content-type':'multipart/form-data'},'fictif');expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'invalid_body'});expect(create).not.toHaveBeenCalled();
  });
  it('conserve la politique sans script de l’avis HTML dans l’application complète',async()=>{
    const r=await createApp().request('/api/checkout/start',{method:'POST',headers:{accept:'text/html','content-type':'application/x-www-form-urlencoded','accept-language':'de'},body:'x'.repeat(5000)});
    expect(r.status).toBe(413);expect(r.headers.get('content-security-policy')).toBe(CHECKOUT_NOTICE_CSP);expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('x-content-type-options')).toBe('nosniff');expect(await r.text()).toContain('<html lang="de">');expect(create).not.toHaveBeenCalled();
  });
  it('conserve aussi exactement la CSP de l’avis 429 après une vraie demande',async()=>{
    await request();const r=await createApp().request('/api/checkout/start',{method:'POST',headers:{accept:'text/html','content-type':'application/x-www-form-urlencoded','x-real-ip':'192.0.2.1'},body:'dataset_ids=finma'});
    expect(r.status).toBe(429);expect(r.headers.get('content-security-policy')).toBe(CHECKOUT_NOTICE_CSP);expect(r.headers.get('retry-after')).toBe('6');expect(create).toHaveBeenCalledTimes(1);
  });
});
