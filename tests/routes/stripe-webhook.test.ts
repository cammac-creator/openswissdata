import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/lib/stripe.js", () => ({ stripe: vi.fn() }));
vi.mock("../../src/lib/email.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/lib/email.js")>(),
  sendPreparedEmail: vi.fn().mockResolvedValue({ sent: true }),
}));
import { stripe } from "../../src/lib/stripe.js";
import { sendPreparedEmail } from "../../src/lib/email.js";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { processOrderDeliveries, deliveryStatus } from "../../src/lib/order-delivery.js";

import { checkoutLegal, termsText, termsDigest } from "../../src/lib/order-legal.js";

const construct = vi.fn();
vi.mocked(stripe).mockReturnValue({webhooks:{constructEventAsync:construct}} as any);
const send = vi.mocked(sendPreparedEmail);
const event = (session:Record<string,unknown>={}, type="checkout.session.completed") => ({
  id:"evt_test", type, livemode:false, data:{object:{
    id:"cs_test_1",mode:"payment",payment_status:"paid",currency:"chf",livemode:false,
    customer_email:"acheteur@example.test",payment_intent:"pi_1",amount_total:29900,
    metadata:{dataset_ids:"tares",locale:"de"},...session,
  }},
});
const post = () => createApp().request("/api/webhook/stripe",{
  method:"POST",headers:{"content-type":"application/json","stripe-signature":"ok"},body:"{}",
});
const rows = (table:string) => getDb().prepare("SELECT * FROM "+table).all() as any[];
const retryNow = () => getDb().prepare("UPDATE order_deliveries SET next_attempt_at=0").run();

describe("Paiements et livraisons durables", () => {
  let tmp:string;
  beforeEach(() => {
    tmp=mkdtempSync(join(tmpdir(),"osd-livraisons-"));
    vi.stubEnv("DATABASE_PATH",join(tmp,"test.sqlite"));
    vi.stubEnv("STRIPE_WEBHOOK_SECRET","whsec_test");
    vi.stubEnv("STRIPE_SECRET_KEY","sk_test_factice");
    vi.stubEnv("BASE_URL","https://www.openswissdata.com");
    vi.stubEnv("NODE_ENV","test");
    const db=getDb(),now=Date.now();
    for(const id of ["tares","classifications","finma"]){
      db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(id,id.toUpperCase(),id,29900,"price_"+id,"2026.09.25",now);
      db.prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES(?,?,?,?,?,?)")
        .run(id,"2026.09.25",id+"/test.zip","a".repeat(64),100,now);
    }
    construct.mockReset().mockResolvedValue(event());
    send.mockReset().mockResolvedValue({sent:true});
  });
  afterEach(() => { closeDb();rmSync(tmp,{recursive:true,force:true});vi.unstubAllEnvs(); });

  it("garde la suspension et signale une acceptation arrivée après le changement d’état",async()=>{
    send.mockImplementationOnce(async()=>{getDb().prepare("UPDATE orders SET status='disputed'").run();getDb().prepare("UPDATE order_deliveries SET state='cancelled',last_error='financial_access_suspended'").run();return {sent:true}});
    await post();await processOrderDeliveries();retryNow();await processOrderDeliveries();
    expect(send).toHaveBeenCalledTimes(1);expect(rows('order_deliveries')[0].state).toBe('cancelled');expect(rows('orders')[0].status).toBe('disputed');expect(rows('delivery_incidents')[0]).toMatchObject({state:'open',reason:'acceptance_after_state_change'});expect(rows('delivery_incident_events')[0].kind).toBe('acceptance_uncertain');
  });
  it("un bail remplacé pendant l’envoi garde son état et une acceptation incertaine distincte",async()=>{
    send.mockImplementationOnce(async()=>{getDb().prepare("UPDATE order_deliveries SET attempts=attempts+1,lease_until=?").run(Date.now()+3600000);return {sent:true}});
    await post();await processOrderDeliveries();await processOrderDeliveries();expect(send).toHaveBeenCalledTimes(1);expect(rows('order_deliveries')[0]).toMatchObject({state:'processing',attempts:2});expect(rows('delivery_incidents')[0]).toMatchObject({state:'open',reason:'acceptance_after_state_change'});expect(rows('delivery_incident_events')[0]).toMatchObject({kind:'acceptance_uncertain',attempts:1});
  });

  it("une panne du registre après acceptation ne provoque pas un second envoi",async()=>{
    send.mockResolvedValueOnce({sent:false,reason:'resend_error'}).mockResolvedValue({sent:true});
    await post();await processOrderDeliveries();
    expect(rows('delivery_incidents')).toHaveLength(1);expect(rows('delivery_incidents')[0].state).toBe('open');
    getDb().exec("CREATE TRIGGER incident_journal_indisponible BEFORE INSERT ON delivery_incident_events BEGIN SELECT RAISE(ABORT,'fictif'); END");
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    try{retryNow();await processOrderDeliveries();retryNow();await processOrderDeliveries();expect(send).toHaveBeenCalledTimes(2);expect(rows('order_deliveries')[0].state).toBe('sent');expect(rows('delivery_incidents')[0].state).toBe('open');expect(log).toHaveBeenCalled()}
    finally{log.mockRestore()}
  });

  it("rattache mail et trace à la commande, conserve le résultat au rejeu", async () => {
    const providerId="11111111-1111-4111-8111-111111111111";
    send.mockResolvedValue({sent:true,providerId});
    await post();await processOrderDeliveries();await post();await processOrderDeliveries();
    expect(rows('order_deliveries')).toHaveLength(1);
    expect(rows('order_deliveries')[0]).toMatchObject({state:'sent',provider_message_id:providerId,payload_json:null,download_token:null});
    expect(rows('download_activity')).toHaveLength(1);
    expect(rows('download_activity')[0]).toMatchObject({order_id:rows('orders')[0].id,customer_id:rows('orders')[0].customer_id,source:'email',authorized_at:null});
    expect(rows('download_tokens')[0].activity_id).toBe(rows('download_activity')[0].id);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("annule la trace et le jeton quand la préparation ne peut plus être revendiquée",async()=>{
    await post();
    getDb().exec("CREATE TRIGGER refus_preparation BEFORE UPDATE OF payload_json ON order_deliveries WHEN NEW.payload_json IS NOT NULL BEGIN SELECT RAISE(IGNORE); END;");
    await processOrderDeliveries();
    expect(rows('download_activity')).toHaveLength(0);expect(rows('download_tokens')).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    expect(rows('order_deliveries')[0]).toMatchObject({state:'pending',payload_json:null,last_error:'delivery_error'});
  });

  it("retire la préparation sans envoi lorsqu’aucune connexion mail n’existe", async () => {
    send.mockResolvedValue({sent:false,reason:'no_api_key'});
    await post();await processOrderDeliveries();
    expect(rows('download_activity')).toHaveLength(0);
    expect(rows('download_tokens')).toHaveLength(0);
    expect(rows('order_deliveries')[0]).toMatchObject({state:'pending',first_attempt_at:null,provider_message_id:null});
  });

  it("conserve une preuve signée et joint exactement les CGV allemandes acceptées, sans doublon au rejeu", async () => {
    const meta = {...checkoutLegal("de", "https://www.openswissdata.com").metadata, dataset_ids:"tares", locale:"de"};
    const confirmed = {...event({metadata:meta,consent:{terms_of_service:"accepted"}}),created:1790400000};
    construct.mockResolvedValue(confirmed);
    await post(); await post();
    expect(rows("order_legal")).toHaveLength(1);
    expect(rows("order_legal")[0]).toMatchObject({status:"accepted",terms_version:"2026-09-26",locale:"de",document_sha256:termsDigest("de"),event_id:"evt_test",event_created_at:1790400000000});
    // Une préférence de correspondance différente ne doit pas changer le contrat joint.
    getDb().prepare("UPDATE order_deliveries SET locale='fr'").run();
    send.mockResolvedValueOnce({sent:false,reason:"network_error"});
    await processOrderDeliveries();
    const first = structuredClone(send.mock.calls[0][0]);
    expect(first.subject).toContain("Votre");
    expect(first.html).toContain("/de/legal/versions/2026-09-26/cgv");
    expect(first.attachments).toHaveLength(1);
    expect(first.attachments![0].filename).toBe("openswissdata-cgv-2026-09-26-de.txt");
    expect(Buffer.from(first.attachments![0].content,"base64").toString("utf8")).toBe(termsText("de"));
    retryNow(); await processOrderDeliveries();
    expect(send.mock.calls[1][0]).toEqual(first);
    expect(rows("order_deliveries")[0].state).toBe("sent");
  });
  it.each([
    {metadata:{dataset_ids:"tares"},status:"legacy"},
    {metadata:{dataset_ids:"tares",...checkoutLegal("fr","https://www.openswissdata.com").metadata},status:"unverified"},
    {metadata:{dataset_ids:"tares",...checkoutLegal("fr","https://www.openswissdata.com").metadata,terms_sha256:"faux"},consent:{terms_of_service:"accepted"},status:"unverified"},
    {metadata:{dataset_ids:"tares",terms_version:"2099-01-01",terms_locale:"en"},consent:{terms_of_service:"accepted"},status:"unverified"},
  ])("ne fabrique pas une acceptation absente ou non identifiable, mais livre les droits payés : $status", async ({status,...session}) => {
    construct.mockResolvedValue(event(session));
    expect((await post()).status).toBe(200);
    expect(rows("order_legal")[0].status).toBe(status);
    await processOrderDeliveries();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].attachments).toBeUndefined();
    construct.mockResolvedValue(event({metadata:{dataset_ids:"tares",...checkoutLegal("en","https://www.openswissdata.com").metadata},consent:{terms_of_service:"accepted"}}));
    await post();
    expect(rows("order_legal")[0].status).toBe(status);
  });
  it("annule ensemble la commande et ses droits si la preuve contractuelle ne peut pas être enregistrée", async () => {
    getDb().exec("CREATE TRIGGER refus_preuve BEFORE INSERT ON order_legal BEGIN SELECT RAISE(ABORT, 'simulation'); END;");
    expect((await post()).status).toBe(500);
    for (const table of ["orders","order_legal","order_grants","order_deliveries"]) expect(rows(table)).toHaveLength(0);
  });

  it("refuse une signature absente ou invalide",async()=>{
    expect((await createApp().request("/api/webhook/stripe",{method:"POST",body:"{}"})).status).toBe(400);
    construct.mockRejectedValueOnce(new Error("signature invalide"));
    expect((await post()).status).toBe(400);
    expect(rows("orders")).toHaveLength(0);
  });
  it("enregistre atomiquement la commande, les droits et la livraison avant tout envoi",async()=>{
    expect((await post()).status).toBe(200);
    expect(rows("orders")[0]).toMatchObject({amount_chf:29900,status:"paid"});
    expect(rows("entitlements")).toHaveLength(1);
    expect(rows("order_deliveries")[0]).toMatchObject({state:"pending",locale:"de"});
    expect(send).not.toHaveBeenCalled();
    await processOrderDeliveries();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain("Ihr Dataset");
    expect(send.mock.calls[0][0].html).toContain("/api/delivery/");
    expect(rows("order_deliveries")[0].state).toBe("sent");
  });
  it("continue si les préférences linguistiques CRM manquent",async()=>{
    getDb().exec("DROP TABLE crm_languages");
    expect((await post()).status).toBe(200);
    await processOrderDeliveries();
    expect(send.mock.calls[0][0].subject).toContain("Ihr Dataset");
  });
  it.each(["unpaid","no_payment_required",undefined])("ne livre pas un paiement non confirmé : %s",async payment_status=>{
    construct.mockResolvedValue(event({payment_status}));
    expect((await post()).status).toBe(200);
    expect(rows("orders")).toHaveLength(0);
    expect(rows("entitlements")).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
  it("livre lorsque Stripe confirme ensuite un paiement différé",async()=>{
    construct.mockResolvedValueOnce(event({payment_status:"unpaid"}))
      .mockResolvedValueOnce(event({},"checkout.session.async_payment_succeeded"));
    await post();await post();
    expect(rows("orders")).toHaveLength(1);
    await processOrderDeliveries();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("livre un achat offert par une remise totale confirmée par Stripe",async()=>{
    construct.mockResolvedValue(event({payment_status:'no_payment_required',amount_total:0,payment_intent:null}));
    expect((await post()).status).toBe(200);
    expect(rows('orders')[0]).toMatchObject({amount_chf:0,status:'paid'});
  });
  it.each([{currency:"eur"},{amount_total:null},{amount_total:-1},{livemode:true}])("refuse une devise, un montant ou un environnement incohérent",async invalid=>{
    construct.mockResolvedValue(event(invalid));
    expect((await post()).status).toBe(400);
    expect(rows("orders")).toHaveLength(0);
  });
  it("refuse aussi un événement de test sur une configuration de production",async()=>{
    vi.stubEnv("STRIPE_SECRET_KEY","sk_live_factice");
    expect((await post()).status).toBe(400);
    expect(rows("orders")).toHaveLength(0);
  });
  it("ne double ni commande ni mail lors des rejeux ou traitements concurrents",async()=>{
    await Promise.all([post(),post()]);
    await Promise.all([processOrderDeliveries(),processOrderDeliveries()]);
    const res=await post();
    expect((await res.json()).idempotent).toBe(true);
    expect(rows("orders")).toHaveLength(1);
    expect(rows("order_deliveries")).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("reprend après une panne avec la même requête et la même clé, même après redémarrage",async()=>{
    send.mockResolvedValueOnce({sent:false,reason:"resend_error"});
    await post();await processOrderDeliveries();
    expect(rows("order_deliveries")[0]).toMatchObject({state:"pending",last_error:"resend_error"});
    const first=send.mock.calls[0];
    closeDb();retryNow();await processOrderDeliveries();
    expect(send.mock.calls[1]).toEqual(first);
    expect(rows("order_deliveries")[0].state).toBe("sent");
  });
  it("récupère une livraison interrompue dont le bail est expiré",async()=>{
    await post();
    getDb().prepare("UPDATE order_deliveries SET state='processing',lease_until=0").run();
    await processOrderDeliveries();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("demande une vérification après la fenêtre de déduplication",async()=>{
    send.mockResolvedValueOnce({sent:false,reason:"resend_error"});
    await post();await processOrderDeliveries();
    getDb().prepare("UPDATE order_deliveries SET first_attempt_at=?,next_attempt_at=0").run(Date.now()-24*3600_000);
    await processOrderDeliveries();
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows("order_deliveries")[0]).toMatchObject({state:"review",last_error:"delivery_confirmation_required"});
  });
  it("attend la configuration mail sans épuiser la fenêtre de déduplication",async()=>{
    send.mockResolvedValueOnce({sent:false,reason:"no_api_key"});
    await post();await processOrderDeliveries();
    expect(rows("order_deliveries")[0]).toMatchObject({state:"pending",first_attempt_at:null,payload_json:null});
    expect(rows("download_tokens")).toHaveLength(0);
    retryNow();await processOrderDeliveries();
    expect(rows("order_deliveries")[0].state).toBe("sent");
  });
  it("ne réinitialise jamais la déduplication après un envoi incertain",async()=>{
    send.mockResolvedValueOnce({sent:false,reason:'resend_error'}).mockResolvedValueOnce({sent:false,reason:'no_api_key'});
    await post();await processOrderDeliveries();
    const first=rows('order_deliveries')[0];
    retryNow();await processOrderDeliveries();
    expect(rows('order_deliveries')[0]).toMatchObject({first_attempt_at:first.first_attempt_at,payload_json:first.payload_json,download_token:first.download_token});
  });
  it("utilise la session Stripe pour la déduplication et purge le corps après remise",async()=>{
    await post();await processOrderDeliveries();
    expect(send.mock.calls[0][1]).toBe('osd-download-cs_test_1-tares');
    expect(rows('order_deliveries')[0]).toMatchObject({payload_json:null,download_token:null});
  });
  it("conserve tous les droits du bundle et reprend le fichier temporairement absent",async()=>{
    construct.mockResolvedValue(event({metadata:{dataset_ids:"bundle,tares"}}));
    getDb().prepare("UPDATE datasets SET current_version=NULL WHERE id='finma'").run();
    await post();await processOrderDeliveries();
    expect(rows("entitlements")).toHaveLength(3);
    expect(send).toHaveBeenCalledTimes(2);
    expect(rows("order_deliveries").find(x=>x.dataset_id==="finma")).toMatchObject({state:"pending",last_error:"version_unavailable"});
    getDb().prepare("UPDATE datasets SET current_version='2026.09.25' WHERE id='finma'").run();
    retryNow();await processOrderDeliveries();
    expect(send).toHaveBeenCalledTimes(3);
    expect(rows("order_deliveries").every(x=>x.state==="sent")).toBe(true);
  });
  it("garde une commande totalement indisponible en attente sans perdre le paiement",async()=>{
    getDb().prepare("UPDATE datasets SET current_version=NULL").run();
    expect((await post()).status).toBe(200);
    await processOrderDeliveries();
    expect(rows("orders")).toHaveLength(1);
    expect(rows("entitlements")).toHaveLength(1);
    expect(rows("order_deliveries")[0].last_error).toBe("version_unavailable");
    expect(send).not.toHaveBeenCalled();
  });
  it("annule la livraison lorsque la commande n'est plus payée",async()=>{
    await post();getDb().prepare("UPDATE orders SET status='refunded'").run();
    await processOrderDeliveries();
    expect(send).not.toHaveBeenCalled();
    expect(rows("order_deliveries")[0].state).toBe("cancelled");
  });
  it("ne remet pas les commandes historiques en livraison",async()=>{
    await post();getDb().prepare("DELETE FROM order_deliveries").run();
    await post();await processOrderDeliveries();
    expect(send).not.toHaveBeenCalled();
  });
  it("annule toutes les écritures si la mise en file échoue",async()=>{
    getDb().exec("DROP TABLE order_deliveries");
    expect((await post()).status).toBe(500);
    expect(rows("orders")).toHaveLength(0);
    expect(rows("entitlements")).toHaveLength(0);
    expect(rows("customers")).toHaveLength(0);
  });
  it("ne divulgue pas les liens privés dans le suivi de livraison",async()=>{
    await post();await processOrderDeliveries();
    const status=JSON.stringify(deliveryStatus());
    expect(status).not.toContain("payload_json");
    expect(status).not.toContain("download_token");
    expect(status).not.toContain("acheteur@example.test");
  });
  it("refuse les achats vides ou inconnus",async()=>{
    construct.mockResolvedValueOnce(event({metadata:{}})).mockResolvedValueOnce(event({metadata:{dataset_ids:"inconnu"}}));
    expect((await post()).status).toBe(400);
    expect((await post()).status).toBe(400);
  });
  it("ignore les autres événements",async()=>{
    construct.mockResolvedValue(event({},"customer.created"));
    expect((await post()).status).toBe(200);
    expect(rows("orders")).toHaveLength(0);
  });
});
