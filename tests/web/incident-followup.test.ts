import { describe, expect, it } from 'vitest';
import { renderDeliveryIncidents } from '../../web/src/lib/delivery-incidents';
import type { DeliveryIncidentPage, IncidentTask } from '../../src/lib/delivery-incidents';
const now=Date.parse('2026-09-26T12:00:00Z');
function page():DeliveryIncidentPage{return {checked_at:now,state:'open',summary:{open:1,accepted:0,cancelled:0},scan:null,retention_days:180,page:{number:1,total_pages:1,total:1,returned:1,limit:20,has_previous:false,has_next:false},incidents:[{id:1,delivery_id:1,order_id:2,customer_id:3,dataset_id:'fictif',state:'open',reason:'resend_error',first_seen_at:now,last_seen_at:now,last_checked_at:now,closed_at:null,observations:1,last_attempts:1,accepted_at:null,task:null}]}}
const task:IncidentTask={id:4,customer_id:3,title:'Action fictive',due_on:'2026-09-29',done_at:null,created_at:now};
describe('Suivi interne distinct du résultat de livraison',()=>{
 it('propose une action seulement sur un incident ouvert non déjà suivi',()=>{
  const data=page();expect(renderDeliveryIncidents(data)).toContain('data-incident-task="1"');
  data.incidents[0].task=task;expect(renderDeliveryIncidents(data)).not.toContain('data-incident-task="1"');
  data.incidents[0].task=null;data.incidents[0].state='accepted';expect(renderDeliveryIncidents(data)).not.toContain('data-incident-task="1"');
 });
 it('signale une action clôturée quand le dossier reste ouvert et permet de la rouvrir explicitement',()=>{
  const data=page();data.incidents[0].task={...task,done_at:0};const html=renderDeliveryIncidents(data);
  expect(html).toContain('L’action est clôturée mais l’incident reste à vérifier');expect(html).toContain('data-incident-reopen="1"');
  data.incidents[0].state='cancelled';expect(renderDeliveryIncidents(data)).not.toContain('data-incident-reopen="1"');
 });
 it('échappe les titres et distingue une date impossible d’une échéance absente',()=>{
  const data=page();data.incidents[0].task={...task,title:'<img src=x onerror=alert(1)>',due_on:'2026-02-31'};const html=renderDeliveryIncidents(data);
  expect(html).not.toContain('<img');expect(html).toContain('&lt;img');expect(html).toContain('Échéance à vérifier');
  data.incidents[0].task.due_on=null;expect(renderDeliveryIncidents(data)).toContain('Sans échéance');
 });
 it('offre une annonce indépendante du contenu remplacé et un suivi focalisable',()=>{
  const html=renderDeliveryIncidents(page());expect(html).toContain('data-incident-announcement role="status"');expect(html).toContain('data-incident-content');expect(html).toContain('data-incident-followup="1" tabindex="-1"');
 });
});
