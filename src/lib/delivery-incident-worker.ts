import {getDb} from './db.js';
import {scanDeliveryIncidents} from './delivery-incidents.js';
/** Aucune requête externe et aucune reprise d'envoi : seulement le registre des états observés. */
export function startDeliveryIncidentWorker(overrides:Partial<{scan:()=>void}>={}):()=>void{
 let stopped=false;let timer:ReturnType<typeof setTimeout>;
 const scan=overrides.scan??(()=>{const result=scanDeliveryIncidents(getDb());if(!result.ok)console.error('[incidents] contrôle partiel ; consulter le registre privé')});
 const tick=()=>{if(stopped)return;try{scan()}catch{console.error('[incidents] contrôle interrompu ; nouvel essai dans une minute')}finally{if(!stopped){timer=setTimeout(tick,60_000);timer.unref()}}};
 timer=setTimeout(tick,30_000);timer.unref();
 return ()=>{stopped=true;clearTimeout(timer)};
}
