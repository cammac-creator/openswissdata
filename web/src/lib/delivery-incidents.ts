import type {DeliveryIncidentPage,DeliveryIncidentEvent,DeliveryIncidentReason,DeliveryIncidentState} from '../../../src/lib/delivery-incidents';
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const number=(value:number)=>new Intl.NumberFormat('fr-CH').format(value);
const date=(value:number|null)=>value!==null&&Number.isFinite(new Date(value).getTime())?new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(value):'Date non disponible';
const reasons:Record<DeliveryIncidentReason,string>={delivery_confirmation_required:'Résultat de l’envoi à vérifier avant toute reprise',financial_sync_pending:'Rapprochement du paiement en attente',version_unavailable:'Version du fichier indisponible',no_api_key:'Connexion mail non configurée',placeholder_key:'Connexion mail non configurée',resend_error:'Prestataire mail momentanément indisponible',send_failed:'Envoi non accepté',delivery_error:'Traitement de livraison interrompu',financial_access_suspended:'Envoi annulé ou suspendu après contrôle financier',order_not_paid:'Commande non payée',proof_missing:'Preuve du résultat à vérifier',resumption_pending:'Reprise prévue ou en cours, résultat à confirmer',acceptance_after_state_change:'Mail accepté après un changement du traitement : contrôle humain nécessaire',unknown:'Situation à vérifier'};
const labels:Record<DeliveryIncidentState,string>={open:'À vérifier',accepted:'Envoi accepté',cancelled:'Envoi annulé ou suspendu'};
const reason=(value:DeliveryIncidentReason)=>Object.hasOwn(reasons,value)?reasons[value]:reasons.unknown;
function content(data:DeliveryIncidentPage){
 const p=data.page,scan=data.scan,age=scan?Date.now()-scan.checked_at:Infinity;
 const monitor=!scan?'Relève non encore vérifiée.':!scan.ok?'Dernier contrôle incomplet : des dossiers restent à vérifier.':age<0||age>180_000?'Relève à revérifier : le dernier contrôle est ancien ou sa date est incohérente.':scan.eligible>scan.limit?`Lecture par lots : ${number(scan.processed)} dossiers contrôlés sur ${number(scan.eligible)} candidats lors du dernier passage.`:`Dernière relève : ${number(scan.processed)} dossier(s) contrôlé(s).`;
 return `<div class="panel-heading"><div><h2 id="incident-title" tabindex="-1">Incidents de livraison</h2><p>${number(data.summary.open)} à vérifier · ${number(data.summary.accepted)} avec envoi accepté · ${number(data.summary.cancelled)} annulé(s) ou suspendu(s)</p></div></div><p class="source-note">${escape(monitor)}${scan?` ${date(scan.checked_at)} · heure suisse.`:''}</p><div class="tabs incident-filters" role="group" aria-label="Filtrer les incidents">${Object.entries(labels).map(([state,label])=>`<button type="button" data-incident-state="${state}" aria-pressed="${data.state===state}">${label}</button>`).join('')}</div><p data-incident-status class="fine" role="status"></p><div class="client-pagination"><span id="incident-page-label" tabindex="-1">${labels[data.state]} · page ${number(p.number)} sur ${number(p.total_pages)} · ${number(p.returned)} sur ${number(p.total)} dossiers</span><div><button type="button" class="button" data-incident-page="${p.number-1}" ${p.has_previous?'':'disabled'}>← Précédente</button><button type="button" class="button" data-incident-page="${p.number+1}" ${p.has_next?'':'disabled'}>Suivante →</button></div></div><div class="incident-list">${data.incidents.length?data.incidents.map(row=>`<article class="incident-card"><div class="panel-heading"><h3>Commande ${row.order_id} · ${escape(row.dataset_id.toUpperCase())}</h3><span class="pill ${row.state==='open'?'amber':row.state==='accepted'?'green':''}">${labels[row.state]}</span></div><p><strong>${row.state==='accepted'?'Le prestataire a accepté l’envoi.':escape(reason(row.reason))}</strong></p><p class="fine">Première observation : ${date(row.first_seen_at)}<br/>Dernier changement observé : ${date(row.last_seen_at)}<br/>${number(row.observations)} observation(s) distincte(s) nécessitant un suivi · compteur de tentatives de la livraison : ${number(row.last_attempts)}</p>${row.accepted_at?`<p class="source-note">Acceptation enregistrée le ${date(row.accepted_at)}. Ce résultat ne prouve pas la réception ni l’ouverture du fichier.</p>`:''}<button type="button" class="button" data-client="${row.customer_id}" aria-label="Ouvrir le client de la commande ${row.order_id}">Fiche client ↗</button><details class="incident-history" data-incident-history="${row.id}"><summary>Observations et résultat du dossier ${row.id}</summary><div data-incident-events><p class="fine">Ouvrir pour consulter les observations conservées.</p></div></details></article>`).join(''):'<p class="empty">Aucun incident observé dans cette sélection.</p>'}</div><p class="source-note">Le registre commence à son activation : aucune panne historique n’est reconstituée. Une relecture identique n’ajoute pas d’échec. L’acceptation du mail et son annulation sont distinctes d’une livraison reçue. Historique technique et dossiers clos conservés 180 jours ; les dossiers ouverts restent présents. Une tâche manuelle cochée ne clôture pas ce registre.</p>`;
}
export function renderDeliveryIncidents(data:DeliveryIncidentPage|null|undefined){return `<section class="panel" id="delivery-incidents">${data?content(data):'<h2>Incidents de livraison</h2><p>Aucune lecture du registre disponible. Utilisez Actualiser pour réessayer.</p>'}</section>`}
type History={incident_id:number;events:DeliveryIncidentEvent[];has_more:boolean;next_before:number|null;retention_days:number};
type Api=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
type Context={data:DeliveryIncidentPage;request:number;abort?:AbortController;histories:Map<HTMLElement,{loading:boolean;before:number|null;loaded:boolean}>};
const contexts=new WeakMap<HTMLElement,Context>();
const eventLabels:Record<DeliveryIncidentEvent['kind'],string>={opened:'Blocage observé',changed:'Nouvelle observation',reopened:'Blocage réapparu',accepted:'Envoi accepté',cancelled:'Envoi annulé ou suspendu',acceptance_uncertain:'Acceptation hors du traitement réservé'};
const eventHtml=(event:DeliveryIncidentEvent)=>`<li><strong>${escape(eventLabels[event.kind]??'Observation')}</strong> · ${date(event.recorded_at)}<br/>${['accepted','acceptance_uncertain'].includes(event.kind)?`Acceptation enregistrée : ${date(event.accepted_at)}`:escape(reason(event.reason))}<br/><span class="fine">Tentative concernée : ${number(event.attempts)}</span></li>`;
/** Les réponses d'un panneau remplacé ou d'une ancienne sélection n'écrasent pas l'écran courant. */
export function bindDeliveryIncidents(initial:DeliveryIncidentPage|null|undefined,api:Api,openClient:(id:number)=>void){
 const root=document.getElementById('delivery-incidents');if(!root||!initial)return;
 let context=contexts.get(root);if(!context){context={data:initial,request:0,histories:new Map()};contexts.set(root,context)}const state=context;
 const bind=()=>{
  root.querySelectorAll<HTMLButtonElement>('[data-client]').forEach(button=>button.onclick=()=>openClient(Number(button.dataset.client)));
  root.querySelectorAll<HTMLButtonElement>('[data-incident-state]').forEach(button=>button.onclick=()=>void load(button.dataset.incidentState as DeliveryIncidentState,1));
  root.querySelectorAll<HTMLButtonElement>('[data-incident-page]').forEach(button=>button.onclick=()=>void load(state.data.state,Number(button.dataset.incidentPage)));
  root.querySelectorAll<HTMLDetailsElement>('[data-incident-history]').forEach(details=>details.ontoggle=()=>{if(details.open&&!state.histories.get(details)?.loaded)void history(details)});
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
 const load=async(filter:DeliveryIncidentState,page:number)=>{
  const request=++state.request;state.abort?.abort();state.abort=new AbortController();const previous=document.activeElement;let succeeded=false;
  root.setAttribute('aria-busy','true');root.querySelector<HTMLElement>('[data-incident-status]')!.textContent='Lecture du registre…';root.querySelectorAll<HTMLButtonElement>('[data-incident-page]').forEach(b=>b.disabled=true);
  try{
   const data=await api<DeliveryIncidentPage>(`/incidents?state=${filter}&page=${page}`,'GET',undefined,state.abort.signal);
   if(request!==state.request||!root.isConnected)return;
   succeeded=true;state.data=data;state.histories.clear();root.innerHTML=content(data);root.querySelector<HTMLElement>('[data-incident-status]')!.textContent=`${number(data.page.total)} dossiers dans cette sélection.`;bind();
  }catch{
   if(request!==state.request||!root.isConnected)return;root.querySelector<HTMLElement>('[data-incident-status]')!.textContent='Lecture indisponible. La sélection précédente reste affichée ; réessayez avec la pagination ou un filtre.';root.querySelectorAll<HTMLButtonElement>('[data-incident-page]').forEach(b=>b.disabled=Number(b.dataset.incidentPage)<state.data.page.number?!state.data.page.has_previous:!state.data.page.has_next);if((document.activeElement===previous||document.activeElement===document.body)&&previous instanceof HTMLButtonElement&&previous.isConnected&&!previous.disabled)previous.focus({preventScroll:true});
  }finally{
   if(request===state.request&&root.isConnected){root.removeAttribute('aria-busy');if(succeeded&&(document.activeElement===previous||document.activeElement===document.body)){const label=root.querySelector<HTMLElement>('#incident-page-label');label?.focus({preventScroll:true});label?.scrollIntoView({block:'nearest'})}}
  }
 };
 bind();
}
