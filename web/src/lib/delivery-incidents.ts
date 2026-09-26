import type {DeliveryIncidentPage,DeliveryIncidentEvent,DeliveryIncidentReason,DeliveryIncidentState,DeliveryIncidentRow,IncidentTask} from '../../../src/lib/delivery-incidents';
import {isCalendarDate} from '../../../src/lib/calendar-date';
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const number=(value:number)=>new Intl.NumberFormat('fr-CH').format(value);
const date=(value:number|null)=>value!==null&&Number.isFinite(new Date(value).getTime())?new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(value):'Date non disponible';
const reasons:Record<DeliveryIncidentReason,string>={delivery_confirmation_required:'Résultat de l’envoi à vérifier avant toute reprise',financial_sync_pending:'Rapprochement du paiement en attente',version_unavailable:'Version du fichier indisponible',no_api_key:'Connexion mail non configurée',placeholder_key:'Connexion mail non configurée',resend_error:'Prestataire mail momentanément indisponible',send_failed:'Envoi non accepté',delivery_error:'Traitement de livraison interrompu',financial_access_suspended:'Envoi annulé ou suspendu après contrôle financier',order_not_paid:'Commande non payée',proof_missing:'Preuve du résultat à vérifier',resumption_pending:'Reprise prévue ou en cours, résultat à confirmer',acceptance_after_state_change:'Mail accepté après un changement du traitement : contrôle humain nécessaire',unknown:'Situation à vérifier'};
const labels:Record<DeliveryIncidentState,string>={open:'À vérifier',accepted:'Envoi accepté',cancelled:'Envoi annulé ou suspendu'};
const reason=(value:DeliveryIncidentReason)=>Object.hasOwn(reasons,value)?reasons[value]:reasons.unknown;
function followup(row:DeliveryIncidentRow){
 const task=row.task,closed=task?.done_at!==null&&task?.done_at!==undefined;
 const due=task?.due_on===null?'Sans échéance':isCalendarDate(task?.due_on)?new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',dateStyle:'medium'}).format(new Date(task.due_on+'T12:00:00Z')):'Échéance à vérifier';
 const body=task?`<p><strong>Action ${number(task.id)} · ${closed?'clôturée':'ouverte'}</strong><br/>${escape(task.title)}</p><p class="fine">${escape(due)} · suivi interne dans les actions du CRM.</p>${closed&&row.state==='open'?'<p class="fine">L’action est clôturée mais l’incident reste à vérifier.</p><button type="button" class="button" data-incident-reopen="'+row.id+'">Rouvrir l’action de suivi</button>':''}`:row.state==='open'?`<details><summary>Prévoir une action de suivi</summary><form data-incident-task="${row.id}" style="margin-top:12px"><label class="field" for="incident-due-${row.id}">Échéance facultative<input id="incident-due-${row.id}" name="due_on" type="date" min="0001-01-01" max="9999-12-31"/></label><button type="submit" class="button">Créer l’action de suivi</button><p class="fine">Une seule action reliée à ce dossier, dans la fiche de son client. Vous pourrez modifier son échéance dans les actions du CRM.</p></form></details>`:'<p class="fine">Aucune action manuelle reliée à ce dossier.</p>';
 return `<div data-incident-followup="${row.id}" tabindex="-1" style="margin:16px 0">${body}<p data-followup-status class="fine"></p><button type="button" class="text-button" data-followup-refresh hidden>Actualiser le suivi</button></div>`;
}
function content(data:DeliveryIncidentPage){
 const p=data.page,scan=data.scan,age=scan?Date.now()-scan.checked_at:Infinity;
 const monitor=!scan?'Relève non encore vérifiée.':!scan.ok?'Dernier contrôle incomplet : des dossiers restent à vérifier.':age<0||age>180_000?'Relève à revérifier : le dernier contrôle est ancien ou sa date est incohérente.':scan.eligible>scan.limit?`Lecture par lots : ${number(scan.processed)} dossiers contrôlés sur ${number(scan.eligible)} candidats lors du dernier passage.`:`Dernière relève : ${number(scan.processed)} dossier(s) contrôlé(s).`;
 return `<div class="panel-heading"><div><h2 id="incident-title" tabindex="-1">Incidents de livraison</h2><p>${number(data.summary.open)} à vérifier · ${number(data.summary.accepted)} avec envoi accepté · ${number(data.summary.cancelled)} annulé(s) ou suspendu(s)</p></div></div><p class="source-note">${escape(monitor)}${scan?` ${date(scan.checked_at)} · heure suisse.`:''}</p><div class="tabs incident-filters" role="group" aria-label="Filtrer les incidents">${Object.entries(labels).map(([state,label])=>`<button type="button" data-incident-state="${state}" aria-pressed="${data.state===state}">${label}</button>`).join('')}</div><p data-incident-status class="fine"></p><div class="client-pagination"><span id="incident-page-label" tabindex="-1">${labels[data.state]} · page ${number(p.number)} sur ${number(p.total_pages)} · ${number(p.returned)} sur ${number(p.total)} dossiers</span><div><button type="button" class="button" data-incident-page="${p.number-1}" ${p.has_previous?'':'disabled'}>← Précédente</button><button type="button" class="button" data-incident-page="${p.number+1}" ${p.has_next?'':'disabled'}>Suivante →</button></div></div><div class="incident-list">${data.incidents.length?data.incidents.map(row=>`<article class="incident-card"><div class="panel-heading"><h3>Commande ${row.order_id} · ${escape(row.dataset_id.toUpperCase())}</h3><span class="pill ${row.state==='open'?'amber':row.state==='accepted'?'green':''}">${labels[row.state]}</span></div><p><strong>${row.state==='accepted'?'Le prestataire a accepté l’envoi.':escape(reason(row.reason))}</strong></p><p class="fine">Première observation : ${date(row.first_seen_at)}<br/>Dernier changement observé : ${date(row.last_seen_at)}<br/>${number(row.observations)} observation(s) distincte(s) nécessitant un suivi · compteur de tentatives de la livraison : ${number(row.last_attempts)}</p>${row.accepted_at?`<p class="source-note">Acceptation enregistrée le ${date(row.accepted_at)}. Ce résultat ne prouve pas la réception ni l’ouverture du fichier.</p>`:''}${followup(row)}<button type="button" class="button" data-client="${row.customer_id}" aria-label="Ouvrir le client de la commande ${row.order_id}">Fiche client ↗</button><details class="incident-history" data-incident-history="${row.id}"><summary>Observations et résultat du dossier ${row.id}</summary><div data-incident-events><p class="fine">Ouvrir pour consulter les observations conservées.</p></div></details></article>`).join(''):'<p class="empty">Aucun incident observé dans cette sélection.</p>'}</div><p class="source-note">Le registre commence à son activation : aucune panne historique n’est reconstituée. Une relecture identique n’ajoute pas d’échec. L’acceptation du mail et son annulation sont distinctes d’une livraison reçue. Historique technique et dossiers clos conservés 180 jours ; les dossiers ouverts restent présents. Une tâche manuelle cochée ne clôture pas ce registre.</p>`;
}
export function renderDeliveryIncidents(data:DeliveryIncidentPage|null|undefined){return `<section class="panel" id="delivery-incidents"><p class="sr-only" data-incident-announcement role="status" aria-atomic="true"></p><div data-incident-content>${data?content(data):'<h2>Incidents de livraison</h2><p>Aucune lecture du registre disponible. Utilisez Actualiser pour réessayer.</p>'}</div></section>`}
type History={incident_id:number;events:DeliveryIncidentEvent[];has_more:boolean;next_before:number|null;retention_days:number};
type Api=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
type Context={data:DeliveryIncidentPage;request:number;writing:boolean;abort?:AbortController;histories:Map<HTMLElement,{loading:boolean;before:number|null;loaded:boolean}>};
const contexts=new WeakMap<HTMLElement,Context>();
const eventLabels:Record<DeliveryIncidentEvent['kind'],string>={opened:'Blocage observé',changed:'Nouvelle observation',reopened:'Blocage réapparu',accepted:'Envoi accepté',cancelled:'Envoi annulé ou suspendu',acceptance_uncertain:'Acceptation hors du traitement réservé'};
const eventHtml=(event:DeliveryIncidentEvent)=>`<li><strong>${escape(eventLabels[event.kind]??'Observation')}</strong> · ${date(event.recorded_at)}<br/>${['accepted','acceptance_uncertain'].includes(event.kind)?`Acceptation enregistrée : ${date(event.accepted_at)}`:escape(reason(event.reason))}<br/><span class="fine">Tentative concernée : ${number(event.attempts)}</span></li>`;
/** Les réponses d'un panneau remplacé ou d'une ancienne sélection n'écrasent pas l'écran courant. */
export function bindDeliveryIncidents(initial:DeliveryIncidentPage|null|undefined,api:Api,openClient:(id:number)=>void){
 const root=document.getElementById('delivery-incidents');if(!root||!initial)return;
 let context=contexts.get(root);if(!context){context={data:initial,request:0,writing:false,histories:new Map()};contexts.set(root,context)}const state=context;
 const lockWrites=(busy:boolean)=>{
  const reading=root.hasAttribute('aria-busy');
  root.querySelectorAll<HTMLInputElement|HTMLButtonElement>('[data-incident-task] input,[data-incident-task] button,[data-incident-reopen]').forEach(control=>control.disabled=busy||reading||control.closest<HTMLElement>('[data-incident-followup]')?.dataset.followupNeedsRead==='true');
  root.querySelectorAll<HTMLButtonElement>('[data-incident-state]').forEach(control=>control.disabled=busy);
  root.querySelectorAll<HTMLButtonElement>('[data-followup-refresh]').forEach(control=>control.disabled=busy||reading);
  root.querySelectorAll<HTMLButtonElement>('[data-incident-page]').forEach(button=>button.disabled=busy||reading||(Number(button.dataset.incidentPage)<state.data.page.number?!state.data.page.has_previous:!state.data.page.has_next));
 };
 const announce=(message:string,request=state.request)=>{const live=root.querySelector<HTMLElement>('[data-incident-announcement]')!;live.textContent='';requestAnimationFrame(()=>{if(root.isConnected&&request===state.request)live.textContent=message})};
 const bind=()=>{
  root.querySelectorAll<HTMLButtonElement>('[data-client]').forEach(button=>button.onclick=()=>openClient(Number(button.dataset.client)));
  root.querySelectorAll<HTMLButtonElement>('[data-incident-state]').forEach(button=>button.onclick=()=>void load(button.dataset.incidentState as DeliveryIncidentState,1));
  root.querySelectorAll<HTMLButtonElement>('[data-incident-page]').forEach(button=>button.onclick=()=>void load(state.data.state,Number(button.dataset.incidentPage)));
  root.querySelectorAll<HTMLFormElement>('[data-incident-task]').forEach(form=>form.onsubmit=event=>{event.preventDefault();const row=state.data.incidents.find(row=>row.id===Number(form.dataset.incidentTask));if(row)void saveFollowup(row,form)});
  root.querySelectorAll<HTMLButtonElement>('[data-incident-reopen]').forEach(button=>button.onclick=()=>{const row=state.data.incidents.find(row=>row.id===Number(button.dataset.incidentReopen));if(row)void saveFollowup(row,button)});
  root.querySelectorAll<HTMLButtonElement>('[data-followup-refresh]').forEach(button=>button.onclick=()=>void load(state.data.state,state.data.page.number));
  root.querySelectorAll<HTMLDetailsElement>('[data-incident-history]').forEach(details=>details.ontoggle=()=>{if(details.open&&!state.histories.get(details)?.loaded)void history(details)});
  lockWrites(state.writing);
 };
 const saveFollowup=async(row:DeliveryIncidentRow,trigger:HTMLFormElement|HTMLButtonElement)=>{
  const host=trigger.closest<HTMLElement>('[data-incident-followup]')!,status=host.querySelector<HTMLElement>('[data-followup-status]')!,refresh=host.querySelector<HTMLButtonElement>('[data-followup-refresh]')!;
  if(state.writing||root.hasAttribute('aria-busy')||host.hasAttribute('aria-busy')||host.dataset.followupNeedsRead==='true')return;
  const creating=trigger instanceof HTMLFormElement,due=creating?String(new FormData(trigger).get('due_on')??''):null;
  if(creating&&!trigger.querySelector<HTMLInputElement>('input[name="due_on"]')!.validity.valid){status.textContent='Choisissez une date réelle ou laissez l’échéance vide.';announce(status.textContent);return}
  if(creating&&due!==''&&!isCalendarDate(due)){status.textContent='Choisissez une date réelle ou laissez l’échéance vide.';announce(status.textContent);return}
  if(!creating&&!row.task)return;
  const request=state.request,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15_000);let focusRetry=false;
  state.writing=true;lockWrites(true);const controls=host.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button');controls.forEach(control=>control.disabled=true);host.setAttribute('aria-busy','true');refresh.hidden=true;status.textContent='Enregistrement du suivi…';announce(status.textContent);
  try{
   let message:string;
   if(creating){const result=await api<{ok:boolean;created:boolean;task:IncidentTask}>(`/incidents/${row.id}/task`,'POST',{due_on:due||null},controller.signal);if(result.ok!==true||typeof result.created!=='boolean'||!Number.isSafeInteger(result.task?.id)||result.task.id<=0||result.task.customer_id!==row.customer_id)throw new Error('incident_task_response_invalid');message=result.created?'Action de suivi créée.':'Action déjà reliée retrouvée ; son échéance est conservée.'}
   else{const result=await api<{ok:boolean}>(`/tasks/${row.task!.id}`,'PATCH',{done:false,expected_state:{done_at:row.task!.done_at,due_on:row.task!.due_on}},controller.signal);if(result.ok!==true)throw new Error('incident_task_response_invalid');message='Action de suivi rouverte.'}
   if(request!==state.request||!root.isConnected||!host.isConnected)return;
   status.textContent=message;const reloaded=await load(state.data.state,state.data.page.number,message,row.id);if(!reloaded&&host.isConnected){refresh.hidden=false;focusRetry=document.activeElement===document.body}
  }catch(error){
   if(request!==state.request||!root.isConnected||!host.isConnected)return;
   const code=(error as {code?:string})?.code;
   const invalidResponse=error instanceof Error&&error.message==='incident_task_response_invalid';
   if(!creating||invalidResponse||['incident_clock_pending','incident_closed'].includes(code??''))host.dataset.followupNeedsRead='true';
   status.textContent=invalidResponse?'La réponse du serveur n’est pas cohérente. Actualisez le suivi avant une nouvelle action.':code==='incident_clock_pending'?'L’heure du contrôle précédent est plus récente. Attendez quelques instants puis actualisez le registre.':code==='incident_closed'?'Le résultat de livraison a changé : aucun nouveau suivi créé. Actualisez le registre.':code==='task_conflict'?'L’action a été modifiée ailleurs. Actualisez son état avant de réessayer.':creating?'L’enregistrement n’a pas été confirmé. Réessayer retrouve la même action si elle a déjà été créée.':'La réouverture n’a pas été confirmée. Actualisez le suivi pour vérifier son état.';
   refresh.hidden=false;
   focusRetry=document.activeElement===document.body;
   announce(status.textContent);
  }finally{clearTimeout(timeout);state.writing=false;if(host.isConnected){host.removeAttribute('aria-busy');controls.forEach(control=>control.disabled=false)}if(root.isConnected)lockWrites(false);if(focusRetry&&host.isConnected&&document.activeElement===document.body&&!refresh.disabled)refresh.focus({preventScroll:true})}
 };
 const history=async(details:HTMLDetailsElement)=>{
  let entry=state.histories.get(details);if(!entry){entry={loading:false,before:null,loaded:false};state.histories.set(details,entry)}if(entry.loading)return;entry.loading=true;
  const host=details.querySelector<HTMLElement>('[data-incident-events]')!;host.querySelector('[data-history-more]')?.remove();
  if(!entry.loaded)host.innerHTML='<p class="fine" role="status">Lecture des observations…</p>';
  const before=entry.before,wasLoaded=entry.loaded,previousFocus=document.activeElement;
  try{
   const result=await api<History>(`/incidents/${details.dataset.incidentHistory}/events${before?`?before=${before}`:''}`);
   if(!details.isConnected)return;
   if(!entry.loaded)host.innerHTML='<p class="fine">Observations récentes, du plus récent au plus ancien. Les événements de plus de 180 jours ont expiré.</p><ol class="incident-events"></ol>';
   const list=host.querySelector('ol')!,previousCount=list.children.length;list.insertAdjacentHTML('beforeend',result.events.map(eventHtml).join(''));
   if(wasLoaded&&(document.activeElement===previousFocus||document.activeElement===document.body)){const next=list.children[previousCount] as HTMLElement|undefined;if(next){next.tabIndex=-1;next.focus({preventScroll:true});next.scrollIntoView({block:'nearest'})}}
   if(!entry.loaded&&!result.events.length)host.insertAdjacentHTML('beforeend','<p class="fine">Aucune observation encore conservée pour ce dossier.</p>');
   entry.loaded=true;entry.before=result.next_before;
   if(result.has_more){host.insertAdjacentHTML('beforeend','<button type="button" class="button" data-history-more>Observations précédentes</button>');host.querySelector<HTMLButtonElement>('[data-history-more]')!.onclick=()=>void history(details)}
  }catch{
   if(!details.isConnected)return;
   if(!entry.loaded)host.textContent='';host.insertAdjacentHTML('beforeend','<p data-history-error class="fine" role="status">Historique momentanément indisponible.</p><button type="button" class="button" data-history-more>Réessayer</button>');const retry=host.querySelector<HTMLButtonElement>('[data-history-more]')!;retry.onclick=()=>{host.querySelector('[data-history-error]')?.remove();void history(details)};if(wasLoaded&&(document.activeElement===previousFocus||document.activeElement===document.body))retry.focus({preventScroll:true});
  }finally{entry.loading=false}
 };
 const load=async(filter:DeliveryIncidentState,page:number,message?:string,focusIncident?:number)=>{
  const request=++state.request;state.abort?.abort();const controller=new AbortController();state.abort=controller;const timeout=setTimeout(()=>controller.abort(),15_000);const previous=document.activeElement,restoreFocus=previous===document.body||root.contains(previous);let succeeded=false;
  root.setAttribute('aria-busy','true');root.querySelector<HTMLElement>('[data-incident-status]')!.textContent='Lecture du registre…';lockWrites(state.writing);announce('Lecture du registre…',request);
  try{
   const data=await api<DeliveryIncidentPage>(`/incidents?state=${filter}&page=${page}`,'GET',undefined,controller.signal);
   if(request!==state.request||!root.isConnected)return;
   succeeded=true;state.data=data;state.histories.clear();root.querySelector<HTMLElement>('[data-incident-content]')!.innerHTML=content(data);const notice=`${message?message+' ':''}${number(data.page.total)} dossiers dans cette sélection.`;root.querySelector<HTMLElement>('[data-incident-status]')!.textContent=notice;bind();announce(notice,request);
  }catch{
   if(request!==state.request||!root.isConnected)return;root.querySelector<HTMLElement>('[data-incident-status]')!.textContent=message?`${message} La relecture du registre a échoué ; Actualiser permet de vérifier son affichage.`:'Lecture indisponible. La sélection précédente reste affichée ; réessayez avec la pagination ou un filtre.';root.querySelectorAll<HTMLButtonElement>('[data-incident-page]').forEach(b=>b.disabled=Number(b.dataset.incidentPage)<state.data.page.number?!state.data.page.has_previous:!state.data.page.has_next);if((document.activeElement===previous||document.activeElement===document.body)&&previous instanceof HTMLButtonElement&&previous.isConnected&&!previous.disabled)previous.focus({preventScroll:true});announce(root.querySelector<HTMLElement>('[data-incident-status]')!.textContent!,request);
  }finally{
   clearTimeout(timeout);
   if(request===state.request&&root.isConnected){root.removeAttribute('aria-busy');lockWrites(state.writing);if(succeeded&&restoreFocus&&(document.activeElement===previous||document.activeElement===document.body)){const label=(focusIncident?root.querySelector<HTMLElement>(`[data-incident-followup="${focusIncident}"]`):null)??root.querySelector<HTMLElement>('#incident-page-label');label?.focus({preventScroll:true});label?.scrollIntoView({block:'nearest'})}}
  }
  return succeeded;
 };
 bind();
}
