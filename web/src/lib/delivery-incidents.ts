import type {DeliveryIncidentPage,DeliveryIncidentEvent,DeliveryIncidentHistory,DeliveryIncidentReason,DeliveryIncidentStatus,DeliveryIncidentRow,IncidentTask,IncidentResolution} from '../../../src/lib/delivery-incidents';
import {isCalendarDate} from '../../../src/lib/calendar-date';
import {RESOLUTION_KINDS,RESOLUTION_NOTE_MAX,isResolutionKind,normalizeResolutionNote,resolutionNoteProblem,type ResolutionKind,type ResolutionNoteProblem} from '../../../src/lib/incident-resolution-rules';
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const number=(value:number)=>new Intl.NumberFormat('fr-CH').format(value);
const date=(value:number|null)=>value!==null&&Number.isFinite(new Date(value).getTime())?new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(value):'Date non disponible';
const reasons:Record<DeliveryIncidentReason,string>={delivery_confirmation_required:'Résultat de l’envoi à vérifier avant toute reprise',financial_sync_pending:'Rapprochement du paiement en attente',version_unavailable:'Version du fichier indisponible',no_api_key:'Connexion mail non configurée',placeholder_key:'Connexion mail non configurée',resend_error:'Prestataire mail momentanément indisponible',send_failed:'Envoi non accepté',delivery_error:'Traitement de livraison interrompu',financial_access_suspended:'Envoi annulé ou suspendu après contrôle financier',order_not_paid:'Commande non payée',proof_missing:'Preuve du résultat à vérifier',resumption_pending:'Reprise prévue ou en cours, résultat à confirmer',acceptance_after_state_change:'Mail accepté après un changement du traitement : contrôle humain nécessaire',unknown:'Situation à vérifier'};
const labels:Record<DeliveryIncidentStatus,string>={open:'À vérifier',resolved:'Clos manuellement',accepted:'Envoi accepté',cancelled:'Envoi annulé ou suspendu'};
const pills:Record<DeliveryIncidentStatus,string>={open:'amber',resolved:'blue',accepted:'green',cancelled:''};
const reason=(value:DeliveryIncidentReason)=>Object.hasOwn(reasons,value)?reasons[value]:reasons.unknown;
// Types de résolution : un libellé et ce qu'il atteste. « Nouvel envoi manuel » déclare un geste fait hors de l'application.
const kinds:Record<ResolutionKind,[string,string]>={provider_delivery_verified:['Remise vérifiée chez le prestataire','Le journal du service mail montre la remise du message.'],customer_contacted:['Client contacté','Le client a confirmé la réception ou a été informé de la situation.'],manual_resend:['Nouvel envoi manuel','Vous avez transmis le fichier vous-même. Cette clôture le déclare : l’application n’envoie rien.'],no_action:['Sans suite','Commande de test, doublon ou situation qui ne demande aucune action.']};
const kindLabel=(value:string)=>isResolutionKind(value)?kinds[value][0]:'Clôture manuelle';
const deliveryStates:Record<string,string>={pending:'en attente',processing:'en cours de traitement',sent:'envoyée',review:'à vérifier',cancelled:'annulée ou suspendue'};
const orderStates:Record<string,string>={paid:'payée',refunded:'remboursée',disputed:'contestée',dispute_lost:'contestation perdue',financial_pending:'rapprochement financier en attente'};
const stateLabel=(map:Record<string,string>,value:string)=>Object.hasOwn(map,value)?map[value]:'inconnue';
const author=(r:IncidentResolution)=>r.by_viewer?'vous':`un autre compte administrateur (n° ${number(r.resolved_by)})`;
const noteProblems:Record<ResolutionNoteProblem,string>={empty:'Écrivez une courte note de preuve.',too_long:`La note dépasse ${RESOLUTION_NOTE_MAX} caractères.`,control:'Retirez les caractères invisibles ou de mise en forme de la note.',email:'Retirez l’adresse mail : la note ne conserve aucune coordonnée.',link:'Retirez le lien : la note ne conserve aucune adresse web.',identifier:'Retirez l’identifiant technique (référence du prestataire ou du paiement, jeton).'};
function followup(row:DeliveryIncidentRow){
 const task=row.task,closed=task?.done_at!==null&&task?.done_at!==undefined;
 const due=task?.due_on===null?'Sans échéance':isCalendarDate(task?.due_on)?new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',dateStyle:'medium'}).format(new Date(task.due_on+'T12:00:00Z')):'Échéance à vérifier';
 const pending=row.status==='open',resolved=row.status==='resolved';
 const body=task?`<p><strong>Action ${number(task.id)} · ${closed?'clôturée':'ouverte'}</strong><br/>${escape(task.title)}</p><p class="fine">${escape(due)} · suivi interne dans les actions du CRM.</p>${closed&&pending?'<p class="fine">L’action est clôturée mais l’incident reste à vérifier.</p><button type="button" class="button" data-incident-reopen="'+row.id+'">Rouvrir l’action de suivi</button>':''}${!closed&&resolved?'<p class="fine">Le dossier est clos manuellement ; cette action reste ouverte jusqu’à ce que vous la terminiez dans les actions du CRM.</p>':''}`:pending?`<details><summary>Prévoir une action de suivi</summary><form data-incident-task="${row.id}" class="incident-task-form"><label class="field" for="incident-due-${row.id}">Échéance facultative<input id="incident-due-${row.id}" name="due_on" type="date" min="0001-01-01" max="9999-12-31"/></label><button type="submit" class="button">Créer l’action de suivi</button><p class="fine">Une seule action reliée à ce dossier, dans la fiche de son client. Vous pourrez modifier son échéance dans les actions du CRM.</p></form></details>`:'<p class="fine">Aucune action manuelle reliée à ce dossier.</p>';
 return `<div data-incident-followup="${row.id}" tabindex="-1" class="incident-followup">${body}<p data-followup-status class="fine"></p><button type="button" class="text-button" data-followup-refresh hidden>Actualiser le suivi</button></div>`;
}
/** Ce qui a remis une clôture en question, dans l'ordre où le registre l'enregistre. */
function supersededBy(row:DeliveryIncidentRow,r:IncidentResolution){
 if(row.state==='accepted')return 'le prestataire a depuis accepté l’envoi';
 if(row.state==='cancelled')return 'l’envoi a depuis été annulé ou suspendu';
 if(row.observations!==r.observations||row.reason!==r.reason)return `une nouvelle observation a été enregistrée le ${date(row.last_seen_at)}`;
 if(row.last_delivery_state!==r.delivery_state)return `la livraison est passée de « ${stateLabel(deliveryStates,r.delivery_state)} » à « ${stateLabel(deliveryStates,row.last_delivery_state)} »`;
 return `la commande est passée de « ${stateLabel(orderStates,r.order_state)} » à « ${stateLabel(orderStates,row.last_order_state)} »`;
}
function closure(row:DeliveryIncidentRow){
 const r=row.resolution;if(!r)return '';
 if(row.status==='resolved')return `<div class="incident-resolution"><p><strong>Clos manuellement le ${date(r.resolved_at)}</strong> par ${escape(author(r))} · ${escape(kindLabel(r.kind))}</p><p class="resolution-note">${escape(r.note)}</p><p class="fine">${r.kind==='manual_resend'?'Déclaration de votre envoi : l’application n’a rien envoyé. ':''}Le registre continue d’observer la livraison : une nouvelle observation ou un changement d’état rouvrira ce dossier, sans effacer cette clôture.</p></div>`;
 const pending=row.status==='open';
 return `<div class="incident-resolution ${pending?'superseded':'historical'}"><p><strong>${pending?'À revérifier : ':''}clos manuellement le ${date(r.resolved_at)}</strong> (${escape(kindLabel(r.kind))}), puis ${escape(supersededBy(row,r))}.</p><p class="fine">Cette clôture reste dans l’historique du dossier.${pending?' Une nouvelle clôture demande une nouvelle preuve.':''}</p></div>`;
}
function resolveForm(row:DeliveryIncidentRow){
 if(row.status!=='open')return '';
 const id=row.id;
 return `<details class="incident-resolve"><summary>Clore ce dossier avec une preuve</summary><form data-incident-resolve="${id}" class="incident-resolve-form" novalidate><fieldset class="resolve-kinds"><legend>Comment le dossier a-t-il été résolu ?</legend>${RESOLUTION_KINDS.map(kind=>`<label class="resolve-kind"><input type="radio" name="kind" value="${kind}"/><span><strong>${escape(kinds[kind][0])}</strong><small>${escape(kinds[kind][1])}</small></span></label>`).join('')}</fieldset><label class="field" for="resolve-note-${id}">Note de preuve<textarea id="resolve-note-${id}" name="note" rows="3" maxlength="${RESOLUTION_NOTE_MAX}" aria-describedby="resolve-help-${id}"></textarea></label><p class="fine" id="resolve-help-${id}">${RESOLUTION_NOTE_MAX} caractères au plus : ce que vous avez vérifié et où. Sans adresse, extrait de mail, lien ni identifiant du prestataire.</p><p class="fine resolve-status" data-resolve-status></p><button type="submit" class="button">Vérifier avant de clore</button><div class="resolve-confirm" data-resolve-confirm hidden><p tabindex="-1" data-resolve-confirm-title><strong>Clore le dossier ${id} ?</strong></p><p class="resolve-summary" data-resolve-summary></p><p class="fine">Votre compte et l’heure du serveur seront enregistrés. Aucun mail n’est envoyé ; la commande, les droits et l’action de suivi ne changent pas. Une nouvelle observation rouvrira le dossier sans effacer cette preuve.</p><div class="resolve-actions"><button type="button" class="primary" data-resolve-confirm-button>Confirmer la clôture</button><button type="button" class="button" data-resolve-edit>Modifier</button></div></div><button type="button" class="text-button" data-resolve-refresh hidden>Actualiser le registre</button></form></details>`;
}
function card(row:DeliveryIncidentRow){
 return `<article class="incident-card"><div class="panel-heading"><h3>Commande ${row.order_id} · ${escape(row.dataset_id.toUpperCase())}</h3><span class="pill ${pills[row.status]}">${labels[row.status]}</span></div><p><strong>${row.state==='accepted'?'Le prestataire a accepté l’envoi.':escape(reason(row.reason))}</strong></p><p class="fine">Première observation : ${date(row.first_seen_at)}<br/>Dernier changement observé : ${date(row.last_seen_at)}<br/>${number(row.observations)} observation(s) distincte(s) nécessitant un suivi · compteur de tentatives de la livraison : ${number(row.last_attempts)}</p>${row.accepted_at?`<p class="source-note">Acceptation enregistrée le ${date(row.accepted_at)}. Ce résultat ne prouve pas la réception ni l’ouverture du fichier.</p>`:''}${closure(row)}${followup(row)}${resolveForm(row)}<button type="button" class="button" data-client="${row.customer_id}" aria-label="Ouvrir le client de la commande ${row.order_id}">Fiche client ↗</button><details class="incident-history" data-incident-history="${row.id}"><summary>Observations et résultat du dossier ${row.id}</summary><div data-incident-events><p class="fine">Ouvrir pour consulter les observations conservées.</p></div></details></article>`;
}
function content(data:DeliveryIncidentPage){
 const p=data.page,scan=data.scan,age=scan?Date.now()-scan.checked_at:Infinity;
 const monitor=!scan?'Relève non encore vérifiée.':!scan.ok?'Dernier contrôle incomplet : des dossiers restent à vérifier.':age<0||age>180_000?'Relève à revérifier : le dernier contrôle est ancien ou sa date est incohérente.':scan.eligible>scan.limit?`Lecture par lots : ${number(scan.processed)} dossiers contrôlés sur ${number(scan.eligible)} candidats lors du dernier passage.`:`Dernière relève : ${number(scan.processed)} dossier(s) contrôlé(s).`;
 const s=data.summary;
 return `<div class="panel-heading"><div><h2 id="incident-title" tabindex="-1">Incidents de livraison</h2><p>${number(s.open)} à vérifier · ${number(s.resolved)} clos manuellement · ${number(s.accepted)} avec envoi accepté · ${number(s.cancelled)} annulé(s) ou suspendu(s)</p></div></div><p class="source-note">${escape(monitor)}${scan?` ${date(scan.checked_at)} · heure suisse.`:''}</p><div class="tabs incident-filters" role="group" aria-label="Filtrer les incidents">${Object.entries(labels).map(([state,label])=>`<button type="button" data-incident-state="${state}" aria-pressed="${data.state===state}">${label}</button>`).join('')}</div><p data-incident-status class="fine"></p><div class="client-pagination"><span id="incident-page-label" tabindex="-1">${labels[data.state]} · page ${number(p.number)} sur ${number(p.total_pages)} · ${number(p.returned)} sur ${number(p.total)} dossiers</span><div><button type="button" class="button" data-incident-page="${p.number-1}" ${p.has_previous?'':'disabled'}>← Précédente</button><button type="button" class="button" data-incident-page="${p.number+1}" ${p.has_next?'':'disabled'}>Suivante →</button></div></div><div class="incident-list">${data.incidents.length?data.incidents.map(card).join(''):'<p class="empty">Aucun incident observé dans cette sélection.</p>'}</div><p class="source-note">Le registre commence à son activation : aucune panne historique n’est reconstituée. Une relecture identique n’ajoute pas d’échec. L’acceptation du mail et son annulation sont distinctes d’une livraison reçue. Une tâche manuelle cochée ne clôture pas ce registre ; seule une clôture manuelle avec preuve le fait, et une nouvelle observation rouvre le dossier sans effacer cette preuve. Historique technique conservé 180 jours ; dossiers acceptés ou annulés conservés 180 jours après leur clôture. Les dossiers à vérifier et ceux clos manuellement restent présents tant que la livraison garde l’état signalé.</p>`;
}
export function renderDeliveryIncidents(data:DeliveryIncidentPage|null|undefined){return `<section class="panel" id="delivery-incidents"><p class="sr-only" data-incident-announcement role="status" aria-atomic="true"></p><div data-incident-content>${data?content(data):'<h2>Incidents de livraison</h2><p>Aucune lecture du registre disponible. Utilisez Actualiser pour réessayer.</p>'}</div></section>`}
type History=DeliveryIncidentHistory;
type Api=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
type Context={data:DeliveryIncidentPage;request:number;writing:boolean;abort?:AbortController;histories:Map<HTMLElement,{loading:boolean;before:number|null;loaded:boolean}>};
const contexts=new WeakMap<HTMLElement,Context>();
const eventLabels:Record<DeliveryIncidentEvent['kind'],string>={opened:'Blocage observé',changed:'Nouvelle observation',reopened:'Blocage réapparu',accepted:'Envoi accepté',cancelled:'Envoi annulé ou suspendu',acceptance_uncertain:'Acceptation hors du traitement réservé'};
const eventHtml=(event:DeliveryIncidentEvent)=>`<li><strong>${escape(eventLabels[event.kind]??'Observation')}</strong> · ${date(event.recorded_at)}<br/>${['accepted','acceptance_uncertain'].includes(event.kind)?`Acceptation enregistrée : ${date(event.accepted_at)}`:escape(reason(event.reason))}<br/><span class="fine">Tentative concernée : ${number(event.attempts)}</span></li>`;
/** Les preuves humaines forment leur propre liste : elles ne s'intercalent pas dans le curseur des observations. */
export function renderResolutionHistory(resolutions:IncidentResolution[]|undefined,total=resolutions?.length??0){
 if(!resolutions?.length)return '';
 return `<div class="incident-closures"><p class="fine"><strong>Clôtures manuelles</strong> · preuves conservées, de la plus récente à la plus ancienne${total>resolutions.length?` (${number(resolutions.length)} affichées sur ${number(total)})`:''}.</p><ol class="incident-events">${resolutions.map(r=>`<li><strong>Clos manuellement · ${escape(kindLabel(r.kind))}</strong> · ${date(r.resolved_at)}<br/>Par ${escape(author(r))}<span class="resolution-note">${escape(r.note)}</span><span class="fine">${r.in_force?'En vigueur':'Remise en question par une observation ou un changement d’état ultérieur'} · situation close : ${escape(reason(r.reason))} · tentative ${number(r.attempts)}</span></li>`).join('')}</ol></div>`;
}
/** Les réponses d'un panneau remplacé ou d'une ancienne sélection n'écrasent pas l'écran courant. */
export function bindDeliveryIncidents(initial:DeliveryIncidentPage|null|undefined,api:Api,openClient:(id:number)=>void){
 const root=document.getElementById('delivery-incidents');if(!root||!initial)return;
 let context=contexts.get(root);if(!context){context={data:initial,request:0,writing:false,histories:new Map()};contexts.set(root,context)}const state=context;
 const lockWrites=(busy:boolean)=>{
  const reading=root.hasAttribute('aria-busy');
  root.querySelectorAll<HTMLInputElement|HTMLButtonElement>('[data-incident-task] input,[data-incident-task] button,[data-incident-reopen]').forEach(control=>control.disabled=busy||reading||control.closest<HTMLElement>('[data-incident-followup]')?.dataset.followupNeedsRead==='true');
  root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement>('[data-incident-resolve] input,[data-incident-resolve] textarea,[data-incident-resolve] button:not([data-resolve-refresh])').forEach(control=>control.disabled=busy||reading||control.closest<HTMLElement>('[data-incident-resolve]')?.dataset.resolveNeedsRead==='true');
  root.querySelectorAll<HTMLButtonElement>('[data-incident-state]').forEach(control=>control.disabled=busy);
  root.querySelectorAll<HTMLButtonElement>('[data-followup-refresh],[data-resolve-refresh]').forEach(control=>control.disabled=busy||reading);
  root.querySelectorAll<HTMLButtonElement>('[data-incident-page]').forEach(button=>button.disabled=busy||reading||(Number(button.dataset.incidentPage)<state.data.page.number?!state.data.page.has_previous:!state.data.page.has_next));
 };
 const announce=(message:string,request=state.request)=>{const live=root.querySelector<HTMLElement>('[data-incident-announcement]')!;live.textContent='';requestAnimationFrame(()=>{if(root.isConnected&&request===state.request)live.textContent=message})};
 const bind=()=>{
  root.querySelectorAll<HTMLButtonElement>('[data-client]').forEach(button=>button.onclick=()=>openClient(Number(button.dataset.client)));
  root.querySelectorAll<HTMLButtonElement>('[data-incident-state]').forEach(button=>button.onclick=()=>void load(button.dataset.incidentState as DeliveryIncidentStatus,1));
  root.querySelectorAll<HTMLButtonElement>('[data-incident-page]').forEach(button=>button.onclick=()=>void load(state.data.state,Number(button.dataset.incidentPage)));
  root.querySelectorAll<HTMLFormElement>('[data-incident-task]').forEach(form=>form.onsubmit=event=>{event.preventDefault();const row=state.data.incidents.find(row=>row.id===Number(form.dataset.incidentTask));if(row)void saveFollowup(row,form)});
  root.querySelectorAll<HTMLButtonElement>('[data-incident-reopen]').forEach(button=>button.onclick=()=>{const row=state.data.incidents.find(row=>row.id===Number(button.dataset.incidentReopen));if(row)void saveFollowup(row,button)});
  root.querySelectorAll<HTMLButtonElement>('[data-followup-refresh],[data-resolve-refresh]').forEach(button=>button.onclick=()=>void load(state.data.state,state.data.page.number));
  root.querySelectorAll<HTMLFormElement>('[data-incident-resolve]').forEach(form=>{
   const row=state.data.incidents.find(row=>row.id===Number(form.dataset.incidentResolve));if(!row)return;
   const confirm=form.querySelector<HTMLElement>('[data-resolve-confirm]')!;
   form.onsubmit=event=>{event.preventDefault();review(form)};
   // Toute modification après le récapitulatif demande une nouvelle vérification avant de clore.
   form.oninput=()=>{confirm.hidden=true};
   form.querySelector<HTMLButtonElement>('[data-resolve-confirm-button]')!.onclick=()=>void saveResolution(row,form);
   form.querySelector<HTMLButtonElement>('[data-resolve-edit]')!.onclick=()=>{confirm.hidden=true;form.querySelector<HTMLTextAreaElement>('textarea')!.focus()};
  });
  root.querySelectorAll<HTMLDetailsElement>('[data-incident-history]').forEach(details=>details.ontoggle=()=>{if(details.open&&!state.histories.get(details)?.loaded)void history(details)});
  lockWrites(state.writing);
 };
 /** Premier temps : contrôle local puis récapitulatif ; rien n'est envoyé avant la confirmation explicite. */
 const review=(form:HTMLFormElement)=>{
  const status=form.querySelector<HTMLElement>('[data-resolve-status]')!,confirm=form.querySelector<HTMLElement>('[data-resolve-confirm]')!,summary=form.querySelector<HTMLElement>('[data-resolve-summary]')!;
  if(state.writing||root.hasAttribute('aria-busy')||form.dataset.resolveNeedsRead==='true')return;
  const data=new FormData(form),kind=String(data.get('kind')??''),note=normalizeResolutionNote(String(data.get('note')??'')),problem=resolutionNoteProblem(note);
  const refusal=!isResolutionKind(kind)?'Choisissez comment le dossier a été résolu.':problem?noteProblems[problem]:'';
  if(refusal){confirm.hidden=true;status.textContent=refusal;announce(refusal);(isResolutionKind(kind)?form.querySelector<HTMLElement>('textarea'):form.querySelector<HTMLElement>('input[name="kind"]'))?.focus();return}
  const label=document.createElement('strong'),quote=document.createElement('span');label.textContent=kinds[kind as ResolutionKind][0];quote.className='resolution-note';quote.textContent=note;summary.replaceChildren(label,quote);
  status.textContent='';confirm.hidden=false;const title=form.querySelector<HTMLElement>('[data-resolve-confirm-title]')!;title.focus({preventScroll:true});title.scrollIntoView({block:'nearest'});
 };
 const saveResolution=async(row:DeliveryIncidentRow,form:HTMLFormElement)=>{
  const status=form.querySelector<HTMLElement>('[data-resolve-status]')!,confirm=form.querySelector<HTMLElement>('[data-resolve-confirm]')!,refresh=form.querySelector<HTMLButtonElement>('[data-resolve-refresh]')!;
  if(state.writing||root.hasAttribute('aria-busy')||form.hasAttribute('aria-busy')||form.dataset.resolveNeedsRead==='true')return;
  const data=new FormData(form),kind=String(data.get('kind')??''),note=normalizeResolutionNote(String(data.get('note')??''));
  if(!isResolutionKind(kind)||resolutionNoteProblem(note)){review(form);return}
  const request=state.request,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15_000);let focusRetry=false;
  state.writing=true;lockWrites(true);form.setAttribute('aria-busy','true');refresh.hidden=true;status.textContent='Enregistrement de la clôture…';announce(status.textContent);
  try{
   // L'état attendu est celui affiché : une observation ou un changement d'état intervenu entre-temps est refusé.
   const result=await api<{ok:boolean;created:boolean;resolution:IncidentResolution}>(`/incidents/${row.id}/resolution`,'POST',{kind,note,expected:{observations:row.observations,reason:row.reason,delivery_state:row.last_delivery_state,order_state:row.last_order_state}},controller.signal);
   if(result.ok!==true||typeof result.created!=='boolean'||!Number.isSafeInteger(result.resolution?.id)||result.resolution.id<=0)throw new Error('incident_resolution_response_invalid');
   if(request!==state.request||!root.isConnected)return;
   const message=result.created?`Dossier ${row.id} clos manuellement ; il figure désormais dans « Clos manuellement ».`:'Ce dossier était déjà clos : la clôture existante est conservée.';
   status.textContent=message;confirm.hidden=true;
   const reloaded=await load(state.data.state,state.data.page.number,message);if(!reloaded&&form.isConnected){refresh.hidden=false;focusRetry=document.activeElement===document.body}
  }catch(error){
   if(request!==state.request||!root.isConnected||!form.isConnected)return;
   const code=(error as {code?:string})?.code??'',invalidResponse=error instanceof Error&&error.message==='incident_resolution_response_invalid';
   const retryable=code==='incident_busy'||code.startsWith('note_')||code==='invalid_body';
   // Sans réponse certaine, seul un nouvel affichage du registre dit si la clôture a été enregistrée.
   if(!retryable)form.dataset.resolveNeedsRead='true';
   confirm.hidden=true;
   status.textContent=invalidResponse?'La réponse du serveur n’est pas cohérente. Actualisez le registre avant une nouvelle clôture.':code==='incident_changed'?'Le dossier a changé depuis votre lecture (nouvelle observation ou changement d’état). Rien n’a été enregistré : actualisez le registre avant de clore.':code==='incident_closed'?'Le résultat de livraison a changé : ce dossier n’est plus à vérifier. Rien n’a été enregistré ; actualisez le registre.':code==='incident_clock_pending'?'L’heure du contrôle précédent est plus récente. Attendez quelques instants puis actualisez le registre.':code==='incident_busy'?'Le registre est momentanément occupé par une autre écriture. Rien n’a été enregistré ; réessayez dans quelques secondes.':code==='not_found'?'Ce dossier n’est plus dans le registre. Actualisez le registre.':code.startsWith('note_')&&Object.hasOwn(noteProblems,code.slice(5))?noteProblems[code.slice(5) as ResolutionNoteProblem]:code==='invalid_body'?'La clôture n’a pas été acceptée : choisissez un type de résolution et une note valide.':'La clôture n’a pas été confirmée. Actualisez le registre : si elle a été enregistrée, le dossier figure dans « Clos manuellement ».';
   refresh.hidden=retryable;
   focusRetry=document.activeElement===document.body;
   announce(status.textContent);
  }finally{clearTimeout(timeout);state.writing=false;if(form.isConnected)form.removeAttribute('aria-busy');if(root.isConnected)lockWrites(false);if(focusRetry&&form.isConnected&&document.activeElement===document.body){const target=refresh.hidden?form.querySelector<HTMLTextAreaElement>('textarea'):refresh;if(target&&!target.disabled)target.focus({preventScroll:true})}}
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
   if(!creating||invalidResponse||['incident_clock_pending','incident_closed','incident_resolved'].includes(code??''))host.dataset.followupNeedsRead='true';
   status.textContent=invalidResponse?'La réponse du serveur n’est pas cohérente. Actualisez le suivi avant une nouvelle action.':code==='incident_clock_pending'?'L’heure du contrôle précédent est plus récente. Attendez quelques instants puis actualisez le registre.':code==='incident_closed'?'Le résultat de livraison a changé : aucun nouveau suivi créé. Actualisez le registre.':code==='incident_resolved'?'Ce dossier a été clos manuellement entre-temps : aucun suivi créé. Actualisez le registre.':code==='task_conflict'?'L’action a été modifiée ailleurs. Actualisez son état avant de réessayer.':creating?'L’enregistrement n’a pas été confirmé. Réessayer retrouve la même action si elle a déjà été créée.':'La réouverture n’a pas été confirmée. Actualisez le suivi pour vérifier son état.';
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
   if(!entry.loaded)host.innerHTML=`${renderResolutionHistory(result.resolutions,result.resolution_total)}<p class="fine">Observations récentes, du plus récent au plus ancien. Les événements de plus de 180 jours ont expiré.</p><ol class="incident-events" data-incident-event-list></ol>`;
   const list=host.querySelector('[data-incident-event-list]')!,previousCount=list.children.length;list.insertAdjacentHTML('beforeend',result.events.map(eventHtml).join(''));
   if(wasLoaded&&(document.activeElement===previousFocus||document.activeElement===document.body)){const next=list.children[previousCount] as HTMLElement|undefined;if(next){next.tabIndex=-1;next.focus({preventScroll:true});next.scrollIntoView({block:'nearest'})}}
   if(!entry.loaded&&!result.events.length)host.insertAdjacentHTML('beforeend','<p class="fine">Aucune observation encore conservée pour ce dossier.</p>');
   entry.loaded=true;entry.before=result.next_before;
   if(result.has_more){host.insertAdjacentHTML('beforeend','<button type="button" class="button" data-history-more>Observations précédentes</button>');host.querySelector<HTMLButtonElement>('[data-history-more]')!.onclick=()=>void history(details)}
  }catch{
   if(!details.isConnected)return;
   if(!entry.loaded)host.textContent='';host.insertAdjacentHTML('beforeend','<p data-history-error class="fine" role="status">Historique momentanément indisponible.</p><button type="button" class="button" data-history-more>Réessayer</button>');const retry=host.querySelector<HTMLButtonElement>('[data-history-more]')!;retry.onclick=()=>{host.querySelector('[data-history-error]')?.remove();void history(details)};if(wasLoaded&&(document.activeElement===previousFocus||document.activeElement===document.body))retry.focus({preventScroll:true});
  }finally{entry.loading=false}
 };
 const load=async(filter:DeliveryIncidentStatus,page:number,message?:string,focusIncident?:number)=>{
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
