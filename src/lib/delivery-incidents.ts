import type Database from 'better-sqlite3';

// Codes fermés : aucun message fournisseur, email ou jeton n'entre dans le registre.
export const DELIVERY_INCIDENT_REASONS = ['delivery_confirmation_required','financial_sync_pending','version_unavailable','no_api_key','placeholder_key','resend_error','send_failed','delivery_error','financial_access_suspended','order_not_paid','proof_missing','resumption_pending','acceptance_after_state_change','unknown'] as const;
export type DeliveryIncidentReason = typeof DELIVERY_INCIDENT_REASONS[number];
export type DeliveryIncidentState = 'open'|'accepted'|'cancelled';
type Source = { id:number; state:string; attempts:number; last_error:string|null; sent_at:number|null; sent_at_type:string; order_status:string };
type Incident = { id:number;delivery_id:number;state:DeliveryIncidentState;reason:DeliveryIncidentReason;first_seen_at:number;last_seen_at:number;last_checked_at:number;closed_at:number|null;observations:number;last_attempts:number;last_delivery_state:string;last_order_state:string;accepted_at:number|null };
const knownOrders=['paid','refunded','disputed','dispute_lost','financial_pending'];
const knownDelivery=['pending','processing','sent','review','cancelled'];
const reason=(value:string|null):DeliveryIncidentReason=>DELIVERY_INCIDENT_REASONS.includes(value as DeliveryIncidentReason)?value as DeliveryIncidentReason:'unknown';
const time=(value:number|null,now:number):value is number=>Number.isSafeInteger(value)&&value!>=1_000_000_000_000&&value!<=now&&value!<=8_640_000_000_000_000;
function classify(source:Source,now:number):{state:DeliveryIncidentState;reason:DeliveryIncidentReason;accepted_at:number|null}|undefined{
 if(!knownDelivery.includes(source.state)||!knownOrders.includes(source.order_status))return {state:'open',reason:'unknown',accepted_at:null};
 if(source.state==='sent')return source.sent_at_type==='integer'&&time(source.sent_at,now)?{state:'accepted',reason:'unknown',accepted_at:source.sent_at}:{state:'open',reason:'proof_missing',accepted_at:null};
 if(source.state==='cancelled')return ['refunded','disputed','dispute_lost'].includes(source.order_status)?{state:'cancelled',reason:'financial_access_suspended',accepted_at:null}:{state:'open',reason:source.last_error==='order_not_paid'?'order_not_paid':'proof_missing',accepted_at:null};
 if(source.state==='review'||(source.state==='pending'&&source.last_error!==null))return {state:'open',reason:reason(source.last_error),accepted_at:null};
 return undefined; // En cours ou jamais tenté : aucune résolution présumée.
}

/** Enregistre uniquement ce qui a été observé ; une relecture identique ne compte pas comme un nouvel échec. */
export function observeDeliveryIncident(db:Database.Database,deliveryId:number,now=Date.now(),unsettledAttempt?:number):void{
 if(!time(now,now)||!Number.isSafeInteger(deliveryId)||deliveryId<=0||(unsettledAttempt!==undefined&&(!Number.isSafeInteger(unsettledAttempt)||unsettledAttempt<1)))throw new Error('incident_input_invalid');
 db.transaction(()=>{
  const source=db.prepare(`SELECT d.id,d.state,d.attempts,d.last_error,d.sent_at,typeof(d.sent_at) sent_at_type,o.status order_status FROM order_deliveries d JOIN orders o ON o.id=d.order_id WHERE d.id=?`).get(deliveryId) as Source|undefined;
  if(!source)return;
  if(!Number.isSafeInteger(source.attempts)||source.attempts<0)throw new Error('incident_attempts_invalid');
  const previous=db.prepare('SELECT * FROM delivery_incidents WHERE delivery_id=?').get(deliveryId) as Incident|undefined;
  const responseAt=now;
  if(previous&&now<previous.last_checked_at){if(unsettledAttempt===undefined)throw new Error('incident_clock_reversed');now=previous.last_checked_at}
  if(unsettledAttempt!==undefined&&previous&&db.prepare("SELECT 1 FROM delivery_incident_events WHERE incident_id=? AND kind='acceptance_uncertain' AND attempts=?").get(previous.id,unsettledAttempt))return;
  // Une acceptation hors du bail ou pendant une suspension exige une vérification humaine : pas de clôture automatique.
  let observation=unsettledAttempt!==undefined?{state:'open' as const,reason:'acceptance_after_state_change' as const,accepted_at:responseAt}:previous?.reason==='acceptance_after_state_change'?{state:'open' as const,reason:previous.reason,accepted_at:previous.accepted_at}:classify(source,now);
  if(!observation&&previous&&previous.state!=='open'&&['pending','processing'].includes(source.state))observation={state:'open',reason:'resumption_pending',accepted_at:null};
  if(!previous&&observation?.state!=='open')return;
  if(!observation){if(previous)db.prepare('UPDATE delivery_incidents SET last_checked_at=? WHERE id=?').run(now,previous.id);return}
  const orderState=knownOrders.includes(source.order_status)?source.order_status:'unknown',deliveryState=knownDelivery.includes(source.state)?source.state:'unknown';
  const changed=unsettledAttempt!==undefined||!previous||previous.state!==observation.state||previous.reason!==observation.reason||(observation.state==='open'&&previous.last_attempts!==source.attempts)||previous.accepted_at!==observation.accepted_at;
  if(!changed){db.prepare('UPDATE delivery_incidents SET last_checked_at=?,last_attempts=?,last_delivery_state=?,last_order_state=? WHERE id=?').run(now,source.attempts,deliveryState,orderState,previous!.id);return}
  const closed=observation.state==='open'?null:previous?.state===observation.state?previous.closed_at:now;
  let id=previous?.id;
  if(previous){
   db.prepare(`UPDATE delivery_incidents SET state=?,reason=?,last_seen_at=?,last_checked_at=?,closed_at=?,observations=observations+?,last_attempts=?,last_delivery_state=?,last_order_state=?,accepted_at=? WHERE id=?`)
    .run(observation.state,observation.reason,now,now,closed,observation.state==='open'?1:0,source.attempts,deliveryState,orderState,observation.accepted_at,previous.id);
  }else{
   id=Number(db.prepare(`INSERT INTO delivery_incidents(delivery_id,state,reason,first_seen_at,last_seen_at,last_checked_at,closed_at,observations,last_attempts,last_delivery_state,last_order_state,accepted_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)`)
    .run(deliveryId,observation.state,observation.reason,now,now,now,closed,source.attempts,deliveryState,orderState,observation.accepted_at).lastInsertRowid);
  }
  const kind=unsettledAttempt!==undefined?'acceptance_uncertain':!previous?'opened':observation.state!=='open'?observation.state:previous.state!=='open'?'reopened':'changed';
  db.prepare('INSERT INTO delivery_incident_events(incident_id,kind,reason,attempts,recorded_at,accepted_at) VALUES(?,?,?,?,?,?)').run(id,kind,observation.reason,unsettledAttempt??source.attempts,now,observation.accepted_at);
 })();
}

/** L'échec du registre ne transforme jamais une acceptation mail en demande de renvoi. */
export function safelyObserveDeliveryIncident(db:Database.Database,id:number,unsettledAttempt?:number):void{
 const outer=db.inTransaction;
 try{observeDeliveryIncident(db,id,Date.now(),unsettledAttempt)}catch(error){
  // Certaines erreurs SQLite annulent toute la transaction : ne jamais continuer en autocommit à son insu.
  if(outer&&!db.inTransaction)throw error;
  const reference=Number.isSafeInteger(id)&&id>0?id:'invalide',attempt=Number.isSafeInteger(unsettledAttempt)&&unsettledAttempt!>0?unsettledAttempt:'invalide';
  console.error(`[incidents] ${unsettledAttempt!==undefined?'ACCEPTATION HORS TRAITEMENT RÉSERVÉ':'Résultat de livraison'} non inscrit · livraison ${reference}${unsettledAttempt!==undefined?` · tentative ${attempt}`:''} ; contrôle nécessaire`);
 }
}

export type IncidentScan = {checked_at:number;ok:boolean;eligible:number;processed:number;errors:number;limit:number};
const SCAN_LIMIT=200;
const candidates=`FROM order_deliveries d JOIN orders o ON o.id=d.order_id LEFT JOIN delivery_incidents i ON i.delivery_id=d.id
 WHERE o.status NOT IN ('paid','refunded','disputed','dispute_lost','financial_pending') OR d.state NOT IN ('pending','processing','sent','review','cancelled') OR
 (d.state='cancelled' AND o.status NOT IN ('refunded','disputed','dispute_lost')) OR
 (d.state='sent' AND (d.sent_at IS NULL OR typeof(d.sent_at)<>'integer' OR d.sent_at<1000000000000 OR d.sent_at>?)) OR d.state='review' OR (d.state='pending' AND d.last_error IS NOT NULL) OR
 (i.id IS NOT NULL AND (i.state='open' OR d.state<>i.last_delivery_state OR o.status<>i.last_order_state OR (d.state='sent' AND d.sent_at IS NOT i.accepted_at)))`;
/** Relève bornée : les dossiers jamais observés puis les plus anciens passent d'abord. */
export function scanDeliveryIncidents(db:Database.Database,now=Date.now()):IncidentScan{
 if(!time(now,now))throw new Error('incident_input_invalid');
 const eligible=(db.prepare(`SELECT COUNT(*) n ${candidates}`).get(now) as {n:number}).n;
 const rows=db.prepare(`SELECT d.id ${candidates} ORDER BY COALESCE(i.last_checked_at,0),d.id LIMIT ?`).all(now,SCAN_LIMIT) as Array<{id:number}>;
 let errors=0;
 for(const row of rows){try{observeDeliveryIncident(db,row.id,now)}catch{errors++}}
 const proof={checked_at:now,ok:errors===0,eligible,processed:rows.length-errors,errors,limit:SCAN_LIMIT};
 db.prepare("INSERT INTO operation_checks(name,checked_at,details_json) VALUES('delivery_incident_scan',?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json").run(now,JSON.stringify(proof));
 return proof;
}
export function readIncidentScan(db:Database.Database):IncidentScan|null{
 try{
  const row=db.prepare("SELECT checked_at,details_json FROM operation_checks WHERE name='delivery_incident_scan'").get() as {checked_at:number;details_json:string}|undefined;
  if(!row)return null;const d=JSON.parse(row.details_json) as IncidentScan;
  if(!time(d.checked_at,d.checked_at)||d.checked_at!==row.checked_at||typeof d.ok!=='boolean'||d.limit!==SCAN_LIMIT||![d.eligible,d.processed,d.errors].every(n=>Number.isSafeInteger(n)&&n>=0)||d.processed+d.errors!==Math.min(d.eligible,SCAN_LIMIT)||d.ok!==(d.errors===0))return null;
  return {checked_at:d.checked_at,ok:d.ok,eligible:d.eligible,processed:d.processed,errors:d.errors,limit:d.limit};
 }catch{return null}
}

export type IncidentTask = {id:number;customer_id:number;title:string;due_on:string|null;done_at:number|null;created_at:number};
/** « resolved » n'existe pas dans le registre machine : c'est un dossier ouvert couvert par une clôture humaine en vigueur. */
export type DeliveryIncidentStatus=DeliveryIncidentState|'resolved';
export const DELIVERY_INCIDENT_STATUSES=['open','resolved','accepted','cancelled'] as const satisfies readonly DeliveryIncidentStatus[];
// Seule la dernière clôture compte, et seulement pour l'observation qu'elle a close : toute nouvelle observation
// ou tout changement d'état enregistré par le registre la remet en question, sans l'effacer.
export const LATEST_RESOLUTION_JOIN='LEFT JOIN delivery_incident_resolutions r ON r.id=(SELECT MAX(x.id) FROM delivery_incident_resolutions x WHERE x.incident_id=i.id)';
export const RESOLUTION_IN_FORCE_SQL="(i.state='open' AND r.id IS NOT NULL AND r.observations=i.observations AND r.reason=i.reason AND r.delivery_state=i.last_delivery_state AND r.order_state=i.last_order_state)";
export const INCIDENT_STATUS_SQL=`CASE WHEN ${RESOLUTION_IN_FORCE_SQL} THEN 'resolved' ELSE i.state END`;
export type IncidentResolution={id:number;kind:string;note:string;resolved_at:number;resolved_by:number;by_viewer:boolean;reason:DeliveryIncidentReason;observations:number;attempts:number;delivery_state:string;order_state:string;in_force:boolean};
type ResolutionRow=Omit<IncidentResolution,'by_viewer'|'in_force'>&{in_force:number};
const resolutionColumns=(alias:string)=>['id','kind','note','resolved_at','resolved_by','reason','observations','attempts','delivery_state','order_state'].map(column=>`${alias}.${column}`).join(',');
const resolutionOf=({in_force,...row}:ResolutionRow,viewer?:number):IncidentResolution=>({...row,by_viewer:viewer!==undefined&&row.resolved_by===viewer,in_force:in_force===1});
/** Une clôture relue avec son statut actuel ; aucune adresse ni référence du prestataire n'y figure. */
export function readIncidentResolution(db:Database.Database,resolutionId:number,viewer?:number):IncidentResolution|null{
 // En vigueur seulement si elle est la dernière clôture de son dossier et couvre encore l'observation enregistrée.
 const row=db.prepare(`SELECT ${resolutionColumns('target')},COALESCE((SELECT ${RESOLUTION_IN_FORCE_SQL} FROM delivery_incidents i ${LATEST_RESOLUTION_JOIN} WHERE i.id=target.incident_id AND r.id=target.id),0) in_force
  FROM delivery_incident_resolutions target WHERE target.id=?`).get(resolutionId) as ResolutionRow|undefined;
 return row?resolutionOf(row,viewer):null;
}
export type DeliveryIncidentRow=Pick<Incident,'id'|'delivery_id'|'state'|'reason'|'first_seen_at'|'last_seen_at'|'last_checked_at'|'closed_at'|'observations'|'last_attempts'|'last_delivery_state'|'last_order_state'|'accepted_at'>&{order_id:number;customer_id:number;dataset_id:string;status:DeliveryIncidentStatus;task:IncidentTask|null;resolution:IncidentResolution|null;resolutions:number};
export type DeliveryIncidentEvent={id:number;kind:'opened'|'changed'|'reopened'|'accepted'|'cancelled'|'acceptance_uncertain';reason:DeliveryIncidentReason;attempts:number;recorded_at:number;accepted_at:number|null};
export function readDeliveryIncidentPage(db:Database.Database,state:DeliveryIncidentStatus,page:number,now=Date.now(),viewer?:number){
 return db.transaction(()=>{
  const counts=db.prepare(`SELECT ${INCIDENT_STATUS_SQL} status,COUNT(*) n FROM delivery_incidents i ${LATEST_RESOLUTION_JOIN} GROUP BY 1`).all() as Array<{status:string;n:number}>;
  const summary=Object.fromEntries(DELIVERY_INCIDENT_STATUSES.map(status=>[status,counts.find(row=>row.status===status)?.n??0])) as Record<DeliveryIncidentStatus,number>;
  const total=summary[state],limit=20,pages=Math.max(1,Math.ceil(total/limit)),number=Math.min(page,pages);
  type TaskColumns={task_id:number|null;task_customer_id:number|null;task_title:string|null;task_due_on:string|null;task_done_at:number|null;task_created_at:number|null};
  type ResolutionColumns={resolution_id:number|null;resolution_kind:string|null;resolution_note:string|null;resolution_resolved_at:number|null;resolution_resolved_by:number|null;resolution_reason:DeliveryIncidentReason|null;resolution_observations:number|null;resolution_attempts:number|null;resolution_delivery_state:string|null;resolution_order_state:string|null;resolution_in_force:number};
  // Les dossiers clos manuellement se lisent par date de clôture ; les autres par dernier changement observé.
  const order=state==='resolved'?'r.resolved_at DESC,i.id DESC':'i.last_seen_at DESC,i.id DESC';
  const raw=db.prepare(`SELECT i.id,i.delivery_id,i.state,i.reason,i.first_seen_at,i.last_seen_at,i.last_checked_at,i.closed_at,i.observations,i.last_attempts,i.last_delivery_state,i.last_order_state,i.accepted_at,d.order_id,o.customer_id,d.dataset_id,
   ${INCIDENT_STATUS_SQL} status,(SELECT COUNT(*) FROM delivery_incident_resolutions x WHERE x.incident_id=i.id) resolutions,
   t.id task_id,t.customer_id task_customer_id,t.title task_title,t.due_on task_due_on,t.done_at task_done_at,t.created_at task_created_at,
   r.id resolution_id,r.kind resolution_kind,r.note resolution_note,r.resolved_at resolution_resolved_at,r.resolved_by resolution_resolved_by,r.reason resolution_reason,r.observations resolution_observations,r.attempts resolution_attempts,r.delivery_state resolution_delivery_state,r.order_state resolution_order_state,${RESOLUTION_IN_FORCE_SQL} resolution_in_force
   FROM delivery_incidents i JOIN order_deliveries d ON d.id=i.delivery_id JOIN orders o ON o.id=d.order_id
   LEFT JOIN delivery_incident_tasks link ON link.incident_id=i.id LEFT JOIN crm_tasks t ON t.id=link.task_id ${LATEST_RESOLUTION_JOIN}
   WHERE i.state=? AND ${INCIDENT_STATUS_SQL}=? ORDER BY ${order} LIMIT ? OFFSET ?`).all(state==='resolved'?'open':state,state,limit,(number-1)*limit) as Array<Omit<DeliveryIncidentRow,'task'|'resolution'>&TaskColumns&ResolutionColumns>;
  const rows:DeliveryIncidentRow[]=raw.map(({task_id,task_customer_id,task_title,task_due_on,task_done_at,task_created_at,resolution_id,resolution_kind,resolution_note,resolution_resolved_at,resolution_resolved_by,resolution_reason,resolution_observations,resolution_attempts,resolution_delivery_state,resolution_order_state,resolution_in_force,...row})=>({...row,
   task:task_id===null?null:{id:task_id,customer_id:task_customer_id!,title:task_title!,due_on:task_due_on,done_at:task_done_at,created_at:task_created_at!},
   resolution:resolution_id===null?null:resolutionOf({id:resolution_id,kind:resolution_kind!,note:resolution_note!,resolved_at:resolution_resolved_at!,resolved_by:resolution_resolved_by!,reason:resolution_reason!,observations:resolution_observations!,attempts:resolution_attempts!,delivery_state:resolution_delivery_state!,order_state:resolution_order_state!,in_force:resolution_in_force},viewer)}));
  return {checked_at:now,state,summary,scan:readIncidentScan(db),retention_days:180,incidents:rows,page:{number,total_pages:pages,total,returned:rows.length,limit,has_previous:number>1,has_next:number<pages}};
 })();
}
export type DeliveryIncidentPage=ReturnType<typeof readDeliveryIncidentPage>;
const RESOLUTION_HISTORY_LIMIT=20;
/** Les clôtures n'accompagnent que la première page : les suivantes ne portent que des observations. */
export type DeliveryIncidentHistory={incident_id:number;events:DeliveryIncidentEvent[];has_more:boolean;next_before:number|null;retention_days:number;resolutions?:IncidentResolution[];resolution_total?:number};
/** Les clôtures ont leur propre suite : elles accompagnent la première page, le curseur reste celui des événements. */
export function readDeliveryIncidentEvents(db:Database.Database,id:number,before?:number,viewer?:number):DeliveryIncidentHistory|undefined{
 return db.transaction(()=>{
  if(!db.prepare('SELECT 1 FROM delivery_incidents WHERE id=?').get(id))return undefined;
  const rows=db.prepare(`SELECT id,kind,reason,attempts,recorded_at,accepted_at FROM delivery_incident_events WHERE incident_id=? ${before===undefined?'':'AND id<?'} ORDER BY id DESC LIMIT 51`).all(id,...(before===undefined?[]:[before])) as DeliveryIncidentEvent[];
  const hasMore=rows.length>50,events=rows.slice(0,50);
  const history:DeliveryIncidentHistory={incident_id:id,events,has_more:hasMore,next_before:hasMore?events.at(-1)!.id:null,retention_days:180};
  if(before!==undefined)return history;
  // Les clôtures plus anciennes restent visibles comme preuves ; seule la dernière peut être en vigueur.
  const resolutions=(db.prepare(`SELECT ${resolutionColumns('r')},CASE WHEN r.id=(SELECT MAX(x.id) FROM delivery_incident_resolutions x WHERE x.incident_id=r.incident_id) THEN ${RESOLUTION_IN_FORCE_SQL} ELSE 0 END in_force
   FROM delivery_incident_resolutions r JOIN delivery_incidents i ON i.id=r.incident_id
   WHERE r.incident_id=? ORDER BY r.id DESC LIMIT ?`).all(id,RESOLUTION_HISTORY_LIMIT) as ResolutionRow[]).map(row=>resolutionOf(row,viewer));
  const total=(db.prepare('SELECT COUNT(*) n FROM delivery_incident_resolutions WHERE incident_id=?').get(id) as {n:number}).n;
  return {...history,resolutions,resolution_total:total};
 })();
}
