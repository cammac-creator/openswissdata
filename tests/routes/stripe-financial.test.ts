import { describe,it,expect,vi,beforeEach,afterEach } from "vitest";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
vi.mock("../../src/lib/stripe.js",()=>({stripe:vi.fn()}));
vi.mock("../../src/lib/crm-source.js",async original=>({...await original<typeof import("../../src/lib/crm-source.js")>(),sourceJson:vi.fn()}));
vi.mock("../../src/lib/email.js",async original=>({...await original<typeof import("../../src/lib/email.js")>(),sendPreparedEmail:vi.fn()}));
vi.mock("../../src/lib/r2.js",()=>({signedDownloadUrl:vi.fn().mockResolvedValue("https://fictif.r2.cloudflarestorage.com/fichier")}));
import { stripe } from "../../src/lib/stripe.js";
import { sourceJson } from "../../src/lib/crm-source.js";
import { sendPreparedEmail } from "../../src/lib/email.js";
import { getDb,closeDb } from "../../src/lib/db.js";
import { createApp } from "../../src/index.js";
import { processFinancialEvents,enqueueFinancialEvent } from "../../src/lib/stripe-financial.js";
import { processOrderDeliveries } from "../../src/lib/order-delivery.js";
import { migrateOrderRights,UPDATE_PERIOD_MS } from "../../src/lib/order-rights.js";

const construct=vi.fn(),read=vi.mocked(sourceJson),send=vi.mocked(sendPreparedEmail);
let sequence=0;
const financial=(type="refund.updated",charge="ch_1",intent="pi_1")=>({id:`evt_${++sequence}`,type,livemode:false,
  data:{object:{id:type==='charge.refunded'?charge:'re_1',charge,payment_intent:intent}}}) as unknown as Stripe.Event;
const post=()=>createApp().request("/api/webhook/stripe",{method:"POST",headers:{"stripe-signature":"fictive"},body:"{}"});
async function buy(n=1){
  construct.mockResolvedValue({id:`evt_checkout_${n}`,type:"checkout.session.completed",livemode:false,data:{object:{
    id:`cs_test_${n}`,livemode:false,mode:"payment",payment_status:"paid",currency:"chf",amount_total:10000,
    payment_intent:`pi_${n}`,customer_email:"client@example.test",metadata:{dataset_ids:"finma",locale:"de"},
  }}});
  expect((await post()).status).toBe(200);
}
function canonical({amount=0,refundStatus="succeeded",dispute=null,charge="ch_1",intent="pi_1"}:{amount?:number;refundStatus?:string;dispute?:string|null;charge?:string;intent?:string}={}){
  read.mockImplementation(async(_source,url)=>{
    const path=new URL(url).pathname;
    if(path.includes("/charges/"))return {id:charge,payment_intent:intent,currency:"chf",amount:10000,paid:true,livemode:false};
    if(path.endsWith("/refunds"))return {data:amount?[{id:"re_1",charge,currency:"chf",amount,status:refundStatus}]:[],has_more:false};
    if(path.endsWith("/disputes"))return {data:dispute?[{id:"du_1",charge,currency:"chf",status:dispute}]:[],has_more:false};
    throw new Error("source inattendue");
  });
}
const order=(n=1)=>getDb().prepare("SELECT * FROM orders WHERE stripe_session_id=?").get(`cs_test_${n}`) as {id:number;status:string;refunded_chf:number;customer_id:number};
const rights=()=>getDb().prepare("SELECT * FROM entitlements").all() as Array<{order_id:number;updates_until:number|null}>;
const delivery=(n=1)=>getDb().prepare("SELECT * FROM order_deliveries WHERE order_id=?").get(order(n).id) as {state:string;last_error:string|null;payload_json:string|null};
const job=()=>getDb().prepare("SELECT * FROM stripe_financial_jobs WHERE charge_id='ch_1'").get() as {state:string;last_error:string|null;revision:number};
async function reconcile(options:Parameters<typeof canonical>[0]={},type="refund.updated"){
  canonical(options);construct.mockResolvedValue(financial(type,options.charge,options.intent));
  expect((await post()).status).toBe(200);await processFinancialEvents();
}

describe("Remboursements, contestations et droits par achat",()=>{
  let temp:string;
  beforeEach(()=>{
    temp=mkdtempSync(join(tmpdir(),"osd-financier-"));
    vi.stubEnv("DATABASE_PATH",join(temp,"fictif.sqlite"));vi.stubEnv("STRIPE_WEBHOOK_SECRET","whsec_factice");
    vi.stubEnv("STRIPE_SECRET_KEY","sk_test_factice");vi.stubEnv("NODE_ENV","test");
    vi.mocked(stripe).mockReturnValue({webhooks:{constructEventAsync:construct}} as unknown as Stripe);
    read.mockReset();send.mockReset().mockResolvedValue({sent:true});
    const db=getDb(),now=Date.now();
    db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES('finma','FINMA','finma',10000,'price_fictive','v1',?)").run(now);
    db.prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('finma','v1','fictif.zip',?,1,?)").run('a'.repeat(64),now-1000);
  });
  afterEach(()=>{closeDb();rmSync(temp,{recursive:true,force:true});vi.unstubAllEnvs()});
  it("enregistre avant de répondre, ignore les doublons et ne fait aucun appel de paiement",async()=>{
    const event=financial();construct.mockResolvedValue(event);expect((await post()).status).toBe(200);
    expect((await(await post()).json()).financial_sync_queued).toBe(false);
    expect(job()).toMatchObject({state:"pending",revision:1});expect(read).not.toHaveBeenCalled();
  });
  it("rejette un événement de test sur la clé de production",async()=>{
    vi.stubEnv("STRIPE_SECRET_KEY","sk_live_factice");construct.mockResolvedValue(financial());
    expect((await post()).status).toBe(400);expect(job()).toBeUndefined();
  });
  it("retire les droits et refuse un lien déjà émis après remboursement complet",async()=>{
    await buy();const db=getDb(),token='R'.repeat(43),now=Date.now();
    db.prepare("INSERT INTO download_tokens(token,customer_id,dataset_id,version,expires_at,created_at) VALUES(?,?,'finma','v1',?,?)").run(token,order().customer_id,now+3600000,now);
    await reconcile({amount:10000});
    expect(order()).toMatchObject({status:"refunded",refunded_chf:10000});expect(rights()).toHaveLength(0);
    expect(delivery()).toMatchObject({state:"cancelled",last_error:"financial_access_suspended",payload_json:null});
    expect((await createApp().request('/api/delivery/'+token,{method:'POST'})).status).toBe(403);
    await processOrderDeliveries();expect(send).not.toHaveBeenCalled();
  });
  it("conserve les droits lors d’un remboursement partiel et additionne toutes les pages",async()=>{
    await buy();canonical();const original=read.getMockImplementation()!;
    read.mockImplementation(async(source,url,init)=>new URL(url).pathname.endsWith('/refunds')?
      {data:[{id:url.includes('starting_after')?'re_2':'re_1',charge:'ch_1',currency:'chf',amount:2000,status:'succeeded'}],has_more:!url.includes('starting_after')}:
      original(source,url,init));
    enqueueFinancialEvent(financial());await processFinancialEvents();
    expect(order()).toMatchObject({status:'paid',refunded_chf:4000});expect(rights()).toHaveLength(1);
    await processOrderDeliveries();expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(['pending','requires_action','failed','canceled'])("ne déduit pas un remboursement %s",async refundStatus=>{
    await buy();await reconcile({amount:10000,refundStatus});
    expect(order()).toMatchObject({status:'paid',refunded_chf:0});expect(rights()).toHaveLength(1);
  });
  it("rétablit les droits quand Stripe confirme l’échec d’un remboursement auparavant réussi",async()=>{
    await buy();await reconcile({amount:10000});await reconcile({amount:10000,refundStatus:'failed'},'refund.failed');
    expect(order()).toMatchObject({status:'paid',refunded_chf:0});expect(rights()).toHaveLength(1);
    expect(delivery().state).toBe('pending');await processOrderDeliveries();expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(['needs_response','under_review','lost'])("suspend les droits pour une contestation %s",async dispute=>{
    await buy();await reconcile({dispute},'charge.dispute.created');
    expect(order().status).toBe(dispute==='lost'?'dispute_lost':'disputed');expect(rights()).toHaveLength(0);
  });
  it.each(['warning_needs_response','warning_under_review','warning_closed','won','prevented'])("conserve les droits pour l’état %s",async dispute=>{
    await buy();await reconcile({dispute},'charge.dispute.updated');expect(order().status).toBe('paid');expect(rights()).toHaveLength(1);
  });
  it("relit Stripe après un événement ancien au lieu de revenir à l’ancienne contestation",async()=>{
    await buy();await reconcile({dispute:'needs_response'},'charge.dispute.created');
    await reconcile({dispute:'won'},'charge.dispute.closed');await reconcile({dispute:'won'},'charge.dispute.created');
    expect(order().status).toBe('paid');expect(rights()).toHaveLength(1);
  });
  it("ne rétablit pas un paiement remboursé même si sa contestation est gagnée",async()=>{
    await buy();await reconcile({amount:10000,dispute:'won'},'charge.dispute.closed');expect(order().status).toBe('refunded');
  });
  it("ne retire pas les droits d’un autre achat et conserve sa période originale",async()=>{
    await buy(1);const until=rights()[0].updates_until;await buy(2);
    await reconcile({amount:10000,charge:'ch_2',intent:'pi_2'});
    expect(rights()).toHaveLength(1);expect(rights()[0]).toMatchObject({order_id:order(1).id,updates_until:until});
    await reconcile({amount:10000});expect(rights()).toHaveLength(0);
  });
  it("préserve le droit sans date limite d’un autre achat",async()=>{
    await buy(1);getDb().prepare('UPDATE order_grants SET updates_until=NULL WHERE order_id=?').run(order(1).id);
    getDb().prepare('UPDATE entitlements SET updates_until=NULL').run();await buy(2);
    await reconcile({amount:10000,charge:'ch_2',intent:'pi_2'});expect(rights()[0].updates_until).toBeNull();
  });
  it("rapproche un remboursement traité avant l’arrivée de la commande",async()=>{
    await reconcile({amount:10000});await buy();expect(order().status).toBe('refunded');expect(rights()).toHaveLength(0);
    await processOrderDeliveries();expect(send).not.toHaveBeenCalled();
  });
  it("attend une notification encore en file avant de donner les droits d’une nouvelle commande",async()=>{
    enqueueFinancialEvent(financial());await buy();expect(order().status).toBe('financial_pending');expect(rights()).toHaveLength(0);
    await processOrderDeliveries();expect(delivery().last_error).toBe('financial_sync_pending');expect(send).not.toHaveBeenCalled();
    canonical();await processFinancialEvents();expect(order().status).toBe('paid');expect(rights()).toHaveLength(1);
  });
  it("ne renvoie pas un mail déjà accepté après une contestation gagnée",async()=>{
    await buy();await processOrderDeliveries();await reconcile({dispute:'needs_response'},'charge.dispute.created');
    await reconcile({dispute:'won'},'charge.dispute.closed');await processOrderDeliveries();expect(send).toHaveBeenCalledTimes(1);
    expect(delivery().state).toBe('sent');
  });
  it("demande une vérification si l’envoi précédent avait un résultat incertain",async()=>{
    await buy();send.mockResolvedValueOnce({sent:false,reason:'resend_error'});await processOrderDeliveries();
    await reconcile({dispute:'needs_response'},'charge.dispute.created');await reconcile({dispute:'won'},'charge.dispute.closed');
    expect(delivery()).toMatchObject({state:'review',payload_json:null});await processOrderDeliveries();expect(send).toHaveBeenCalledTimes(1);
  });
  it("reprend après redémarrage et panne de Stripe sans écraser l’état précédent",async()=>{
    await buy();await reconcile({amount:10000});enqueueFinancialEvent(financial());read.mockRejectedValue(new Error('panne externe avec information sensible'));
    await processFinancialEvents();expect(order().status).toBe('refunded');expect(job()).toMatchObject({state:'pending',last_error:'financial_sync_failed'});
    closeDb();getDb().prepare('UPDATE stripe_financial_jobs SET next_attempt_at=0').run();canonical({refundStatus:'failed'});
    await processFinancialEvents();expect(order().status).toBe('paid');expect(job().state).toBe('synced');
  });
  it("abandonne une photographie si une nouvelle notification arrive pendant la lecture",async()=>{
    await buy();canonical({amount:10000});const original=read.getMockImplementation()!;let notified=false;
    read.mockImplementation(async(source,url,init)=>{const result=await original(source,url,init);if(!notified){notified=true;enqueueFinancialEvent(financial())}return result});
    enqueueFinancialEvent(financial());await processFinancialEvents();expect(job()).toMatchObject({state:'pending',revision:2});
    expect(order().status).toBe('paid');canonical();await processFinancialEvents();expect(job().state).toBe('synced');
  });
  it("empêche deux workers de traiter le même paiement simultanément",async()=>{
    await buy();canonical({amount:10000});enqueueFinancialEvent(financial());
    await Promise.all([processFinancialEvents(),processFinancialEvents()]);expect(read).toHaveBeenCalledTimes(3);expect(order().status).toBe('refunded');
  });
  it.each(['amount','mode','charge','unknown_status','pagination'])("conserve les droits précédents si la réponse est incohérente : %s",async kind=>{
    await buy();canonical({amount:10000});const original=read.getMockImplementation()!;
    read.mockImplementation(async(source,url,init)=>{
      const result=await original(source,url,init) as Record<string,unknown>;
      if(url.includes('/charges/')){if(kind==='amount')result.amount=9999;if(kind==='mode')result.livemode=true;if(kind==='charge')result.id='ch_autre'}
      if(url.includes('/refunds')){if(kind==='unknown_status')(result.data as Array<Record<string,unknown>>)[0].status='inconnu';if(kind==='pagination')result.has_more=true}
      return result;
    });
    enqueueFinancialEvent(financial());await processFinancialEvents();expect(job().state).toBe('pending');expect(order().status).toBe('paid');
    expect(getDb().prepare('SELECT COUNT(*) n FROM stripe_charge_states').get()).toEqual({n:0});
  });
  it("importe une ancienne base sans étendre les accès et garde les achats antérieurs",async()=>{
    await buy(1);await buy(2);const db=getDb(),now=Date.now();
    db.prepare('UPDATE orders SET created_at=? WHERE id=?').run(now-100*86400000,order(1).id);
    db.prepare('UPDATE entitlements SET updates_until=?,created_at=?').run(now+50*86400000,now-100*86400000);
    db.exec("DELETE FROM order_grants;DELETE FROM app_migrations WHERE name='order_grants_v1'");
    const before=rights();migrateOrderRights(db);migrateOrderRights(db);
    expect(rights()).toEqual(before);expect(db.prepare('SELECT COUNT(*) n FROM order_grants').get()).toEqual({n:2});
    await reconcile({amount:10000,charge:'ch_2',intent:'pi_2'});
    expect(rights()[0]).toMatchObject({order_id:order(1).id,updates_until:now+50*86400000});
    expect(rights()[0].updates_until).toBeLessThan(now-100*86400000+UPDATE_PERIOD_MS);
  });
  it("ajoute les colonnes à une base existante et reprend les droits sans renvoyer d’ancien mail",async()=>{
    await buy();const before=rights();getDb().exec(`DELETE FROM order_deliveries;DELETE FROM order_grants;
      DELETE FROM app_migrations WHERE name='order_grants_v1';
      ALTER TABLE orders DROP COLUMN refunded_chf;ALTER TABLE orders DROP COLUMN dispute_status;
      ALTER TABLE orders DROP COLUMN financial_checked_at`);closeDb();
    expect(order()).toMatchObject({status:'paid',refunded_chf:0});expect(rights()).toEqual(before);
    expect(getDb().prepare('SELECT COUNT(*) n FROM order_grants').get()).toEqual({n:1});
    await processOrderDeliveries();expect(send).not.toHaveBeenCalled();
  });
  it("une panne de relecture périodique ne retarde pas une livraison déjà validée",async()=>{
    await buy();await reconcile({amount:2000});getDb().prepare('UPDATE stripe_financial_jobs SET next_attempt_at=0').run();
    read.mockRejectedValue(new Error('panne'));await processFinancialEvents();expect(job().state).toBe('pending');
    await processOrderDeliveries();expect(send).toHaveBeenCalledTimes(1);expect(order().status).toBe('paid');
  });
  it("n’attribue pas au client B un droit du client A lié par erreur à sa commande",async()=>{
    await buy();const db=getDb(),now=Date.now();
    db.prepare("INSERT INTO customers(id,email,created_at) VALUES(99,'autre@example.test',?)").run(now);
    db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,created_at) VALUES('tares','TARES','tares',10000,'price_t',?)").run(now);
    db.prepare("INSERT INTO entitlements(customer_id,dataset_id,order_id,updates_until,created_at) VALUES(99,'tares',?,NULL,?)").run(order().id,now);
    db.exec("DELETE FROM app_migrations WHERE name='order_grants_v1'");migrateOrderRights(db);
    expect(db.prepare("SELECT * FROM order_grants WHERE dataset_id='tares'").all()).toHaveLength(0);
    await reconcile({amount:2000});
    expect(db.prepare("SELECT dataset_id FROM entitlements WHERE customer_id=?").all(order().customer_id)).toEqual([{dataset_id:'finma'}]);
  });
  it("reprend un droit ajouté pendant un retour temporaire à l’ancien code",async()=>{
    await buy();const db=getDb();db.exec('DELETE FROM order_grants');closeDb();
    expect(getDb().prepare('SELECT COUNT(*) n FROM order_grants').get()).toEqual({n:1});
    await reconcile({amount:10000});expect(rights()).toHaveLength(0);
  });
  it.each([['stripe-financial_http_403','financial_permission_denied'],['crm_bronze_capacity','financial_storage_full']])(
    "rend exploitable l’erreur %s sans conserver les détails sensibles",async(message,code)=>{
      await buy();enqueueFinancialEvent(financial());read.mockRejectedValue(new Error(message));await processFinancialEvents();
      expect(job().last_error).toBe(code);
    });
});
