import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Stripe from 'stripe';
import { Hono } from 'hono';
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../src/lib/stripe.js', () => ({ stripe: () => ({ checkout: { sessions: { create } } }), resetStripeClient: vi.fn() }));
import { createApp } from '../../src/index.js';
import { checkoutRoute } from '../../src/routes/checkout.js';
import { getDb, closeDb } from '../../src/lib/db.js';
import * as tracking from '../../src/lib/track.js';
import * as budget from '../../src/lib/event-budget.js';

describe('Créations Checkout observées, sans appeler Stripe', () => {
  let temp:string, serial:number;
  const browser={'user-agent':'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36','x-real-ip':'192.0.2.15'};
  beforeEach(() => {
    temp=mkdtempSync(join(tmpdir(),'osd-checkout-measures-'));serial=0;
    vi.stubEnv('DATABASE_PATH',join(temp,'fictif.sqlite'));vi.stubEnv('BASE_URL','https://www.openswissdata.com');
    vi.stubEnv('STRIPE_PRICE_BUNDLE','price_fictif_bundle');vi.stubEnv('NODE_ENV','test');vi.stubEnv('MCP_SUBSCRIPTIONS_OPEN','false');
    vi.stubEnv('RAILWAY_ENVIRONMENT_ID','railway-fictif');vi.stubEnv('SESSION_SECRET','cle-fictive-pour-mesures-checkout');
    for(const id of ['finma','tares','classifications'])getDb().prepare('INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES(?,?,?,29900,?,?)').run(id,id,id,'price_fictif_'+id,Date.now());
    create.mockImplementation(async(params:Stripe.Checkout.SessionCreateParams)=>({id:'cs_live_fictif'+(++serial),url:'https://checkout.stripe.com/fictif'+serial,livemode:true,mode:params.mode}));
  });
  afterEach(async()=>{await new Promise(r=>setImmediate(r));closeDb();rmSync(temp,{recursive:true,force:true});create.mockReset();vi.restoreAllMocks();vi.unstubAllEnvs()});
  async function request(ids=['finma'],entry='api',locale='fr',app=createApp()) {
    return app.request('/api/checkout/'+(entry==='api'?'session':'start'),{method:'POST',headers:{...browser,'content-type':entry==='api'?'application/json':'application/x-www-form-urlencoded'},
      body:entry==='api'?JSON.stringify({dataset_ids:ids,email:'acheteur@example.test',locale}):new URLSearchParams({dataset_ids:ids.join(','),email:'acheteur@example.test',locale}).toString()});
  }
  async function rows(){await new Promise(r=>setImmediate(r));return getDb().prepare("SELECT kind,origin,name,status,visitor_hash,customer_id,referer,country,meta_json,ua_class FROM events WHERE name='checkout_started'").all() as Array<Record<string,unknown>>}
  it.each(['api','form'])('observe une création %s confirmée, sans changer contrat, paramètres ou réponse',async entry=>{
    const r=await request(['finma'],entry,'de');expect(r.status).toBe(entry==='api'?200:303);
    if(entry==='api')expect(await r.json()).toEqual({url:'https://checkout.stripe.com/fictif1',session_id:'cs_live_fictif1'});else expect(r.headers.get('location')).toBe('https://checkout.stripe.com/fictif1');
    expect(create).toHaveBeenCalledTimes(1);expect(create.mock.calls[0][0]).toMatchObject({mode:'payment',locale:'de',customer_email:'acheteur@example.test',line_items:[{price:'price_fictif_finma',quantity:1}],consent_collection:{terms_of_service:'required'},metadata:{terms_version:'2026-09-26',terms_locale:'de',dataset_ids:'finma'}});
    const records=await rows();expect(records).toHaveLength(1);expect(records[0]).toEqual({kind:'conversion',origin:'server',name:'checkout_started',status:entry==='api'?200:303,visitor_hash:expect.stringMatching(/^v2:[a-f0-9]{24}$/),customer_id:null,referer:null,country:null,meta_json:JSON.stringify({schema:1,livemode:true,basket:'finma',locale:'de',entry}),ua_class:'desktop'});
    expect(JSON.stringify(records)).not.toMatch(/@|cs_live_|https:|192\.0\.2|price_fictif|Mozilla/);
    expect(getDb().prepare('SELECT COUNT(*) n FROM orders').get()).toEqual({n:0});expect(getDb().prepare('SELECT COUNT(*) n FROM customers').get()).toEqual({n:0});
  });
  it.each([['finma','finma'],['tares','tares'],['classifications','classifications'],['bundle','bundle'],['finma,tares','mixed'],['finma,finma','finma']])('classe le panier %s sans multiplier les créations',async(ids,basket)=>{
    expect((await request(ids.split(','))).status).toBe(200);const records=await rows();expect(records).toHaveLength(1);expect(JSON.parse(records[0].meta_json as string).basket).toBe(basket);
  });
  it('compte deux créations distinctes et déduit la langue française par défaut du parcours',async()=>{
    const app=createApp();for(let i=0;i<2;i++)expect((await app.request('/api/checkout/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dataset_ids:['finma']})})).status).toBe(200);
    expect(create).toHaveBeenCalledTimes(2);expect((await rows()).map(r=>JSON.parse(r.meta_json as string).locale)).toEqual(['fr','fr']);
  });
  it.each([
    {livemode:false},{livemode:undefined},{mode:'subscription'},{mode:undefined},{id:'cs_test_fictif'},{id:''},{id:undefined},
  ])('conserve le parcours mais ne mesure pas une réponse non attestée : %j',async override=>{
    create.mockResolvedValue({id:'cs_live_fictif',url:'https://checkout.stripe.com/fictif',livemode:true,mode:'payment',...override});
    expect((await request()).status).toBe(200);expect(await rows()).toEqual([]);
  });
  it.each(['api','form'])('les erreurs Stripe et URL manquantes ne deviennent pas des créations (%s)',async entry=>{
    vi.spyOn(console,'error').mockImplementation(()=>{});create.mockRejectedValue(new Error('échec fictif'));const fail=await request(['finma'],entry);expect(fail.status).toBe(entry==='api'?502:303);
    create.mockResolvedValue({id:'cs_live_fictif',url:null,livemode:true,mode:'payment'});const absent=await request(['finma'],entry);expect(absent.status).toBe(entry==='api'?502:303);
    expect(await rows()).toEqual([]);
  });
  it.each(['api','form'])('les refus du panier et abonnements fermés ne contactent pas Stripe (%s)',async entry=>{
    for(const ids of [['inconnu'],['bundle','finma'],['mcp_standalone']]){
      const r=await request(ids,entry);expect([400,503,303]).toContain(r.status);
    }
    expect(create).not.toHaveBeenCalled();expect(await rows()).toEqual([]);
  });
  it.each(['api','form'])('une panne de mesure différée conserve la réponse commerciale (%s)',async entry=>{
    getDb().exec('DROP TABLE events');vi.spyOn(console,'warn').mockImplementation(()=>{});
    const r=await request(['finma'],entry);expect(r.status).toBe(entry==='api'?200:303);expect(create).toHaveBeenCalledTimes(1);
    await new Promise(r=>setImmediate(r));budget.flushEventCoverage(getDb());expect(budget.readEventCoverage(getDb()).gaps.some(g=>(g.reasons.write??0)>0)).toBe(true);
  });
  it('une panne synchrone de préparation laisse la redirection et ne relance pas Stripe',async()=>{
    vi.spyOn(tracking,'uaClassFromRequest').mockImplementation(()=>{throw new Error('fictif privé')});vi.spyOn(console,'warn').mockImplementation(()=>{});
    const app=new Hono().route('/api/checkout',checkoutRoute),r=await request(['finma'],'form','fr',app);
    expect(r.status).toBe(303);expect(r.headers.get('location')).toBe('https://checkout.stripe.com/fictif1');expect(create).toHaveBeenCalledTimes(1);expect(await rows()).toEqual([]);
  });
  it('une panne synchrone de file ne remplace pas le succès par un échec Stripe',async()=>{
    vi.spyOn(budget,'queueEvent').mockImplementation(()=>{throw new Error('file fictive indisponible')});vi.spyOn(console,'warn').mockImplementation(()=>{});
    const r=await request();expect(r.status).toBe(200);expect(create).toHaveBeenCalledTimes(1);expect(await rows()).toEqual([]);
  });
  it.each(['api','form'])('un diagnostic lui-même en panne conserve le succès après une observation défaillante (%s)',async entry=>{
    const session={id:'cs_live_fictif1',url:'https://checkout.stripe.com/fictif1',mode:'payment',get livemode(){throw new Error('observation fictive indisponible')}};
    create.mockResolvedValue(session);const report=vi.spyOn(budget,'reportEventFailure').mockImplementation(()=>{throw new Error('diagnostic fictif indisponible')});
    const r=await request(['finma'],entry);expect(r.status).toBe(entry==='api'?200:303);
    if(entry==='api')expect(await r.json()).toEqual({url:session.url,session_id:session.id});else expect(r.headers.get('location')).toBe(session.url);
    expect(create).toHaveBeenCalledTimes(1);expect(report).toHaveBeenCalledTimes(1);expect(await rows()).toEqual([]);
  });
  it.each(['api','form'])('un diagnostic lui-même en panne conserve le succès après une préparation défaillante (%s)',async entry=>{
    vi.spyOn(tracking,'uaClassFromRequest').mockImplementation(()=>{throw new Error('préparation fictive indisponible')});const report=vi.spyOn(budget,'reportEventFailure').mockImplementation(()=>{throw new Error('diagnostic fictif indisponible')});
    const app=new Hono().route('/api/checkout',checkoutRoute),r=await request(['finma'],entry,'fr',app);expect(r.status).toBe(entry==='api'?200:303);
    if(entry==='api')expect(await r.json()).toEqual({url:'https://checkout.stripe.com/fictif1',session_id:'cs_live_fictif1'});else expect(r.headers.get('location')).toBe('https://checkout.stripe.com/fictif1');
    expect(create).toHaveBeenCalledTimes(1);expect(report).toHaveBeenCalledTimes(1);expect(await rows()).toEqual([]);
  });
  it.each([{}, {name:'Checkout_Started'}, {origin:'server'}, {meta_json:'{"schema":1,"livemode":true,"basket":"finma","locale":"fr","entry":"api"}'}])('refuse une déclaration publique forgée sans créer de preuve : %j',async extra=>{
    const r=await createApp().request('/api/events/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'checkout_started',kind:'conversion',meta:{schema:1,livemode:true,basket:'finma',locale:'fr',entry:'api'},...extra})});
    expect(r.status).toBe(400);expect(await r.json()).toEqual({error:('origin' in extra || 'meta_json' in extra)?'invalid_body':'reserved_event'});expect(create).not.toHaveBeenCalled();expect(await rows()).toEqual([]);
  });
  it('la vraie protection du journal couvre aussi la mesure API globale après un succès',async()=>{
    // Dépasser la dernière alerte du module pour prouver l’appel effectif du journal.
    vi.spyOn(Date,'now').mockReturnValue(Date.parse('2027-01-20T12:00:00Z'));
    vi.spyOn(budget,'queueEvent').mockImplementation(()=>{throw new Error('file fictive indisponible')});
    const log=vi.spyOn(console,'warn').mockImplementation(()=>{throw new Error('sortie de journal fictive indisponible')});
    const r=await request();expect(r.status).toBe(200);expect(await r.json()).toEqual({url:'https://checkout.stripe.com/fictif1',session_id:'cs_live_fictif1'});
    expect(log).toHaveBeenCalledTimes(1);expect(create).toHaveBeenCalledTimes(1);expect(await rows()).toEqual([]);
  });
});
