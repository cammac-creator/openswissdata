import type { DownloadActivity, OrderService } from "../../../src/lib/customer-service";
const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[x]!);
const date = (v: number) => new Intl.DateTimeFormat("fr-CH", {dateStyle:"medium",timeStyle:"short",timeZone:"Europe/Zurich"}).format(v);
const deliveryNames: Record<string, string> = { pending:"En attente de reprise", processing:"Traitement en cours", review:"Confirmation à vérifier chez Resend", cancelled:"Livraison arrêtée", sent:"Accepté par Resend" };
const errorNames: Record<string, string> = { version_unavailable:"Version du fichier indisponible", financial_sync_pending:"Vérification financière en attente", delivery_confirmation_required:"Résultat de l’envoi à confirmer", order_not_paid:"Commande non payable actuellement", delivery_error:"Incident technique lors de l’envoi", no_api_key:"Connexion aux envois absente", resend_error:"Prestataire momentanément indisponible" };

function downloadRows(rows: DownloadActivity[]): string {
  return rows.map(d => `<li><span class="service-dot" aria-hidden="true"></span><div><strong>${escape(d.dataset_id.toUpperCase())} · ${escape(d.version)}</strong>
    <p>${d.source === "email" ? "Lien préparé pour le mail" : "Lien fourni depuis le compte"} · ${date(d.created_at)}</p>
    <p>${d.authorized_at ? `Téléchargement autorisé le ${date(d.authorized_at)}` : "Aucune utilisation de ce lien de partage enregistrée"}</p></div></li>`).join("");
}

export function renderOrderService(order: {id:number;created_at:number;service?:OrderService}): string {
  const service = order.service;
  return `<details class="service-history"><summary>Parcours de la commande #${escape(order.id)}</summary>
    <ol class="service-timeline"><li><span class="service-dot" aria-hidden="true"></span><div><strong>Commande enregistrée</strong><p>${date(order.created_at)} · source : application</p></div></li>
    ${service?.deliveries.map(d => `<li><span class="service-dot ${["review","cancelled"].includes(d.state) ? "service-alert" : ""}" aria-hidden="true"></span><div>
      <strong>${escape(d.dataset_id.toUpperCase())} · ${escape(deliveryNames[d.state] ?? "État à contrôler")}</strong>
      <p>${d.sent_at ? date(d.sent_at) : `Préparation depuis le ${date(d.created_at)}`} · ${escape(d.attempts)} tentative(s) de traitement</p>
      ${d.last_error ? `<p>${escape(errorNames[d.last_error] ?? "Le suivi technique demande un contrôle.")}</p>` : ""}
      ${d.provider_message_id && /^[a-f0-9-]{36}$/i.test(d.provider_message_id) ? `<button class="text-button" data-mail-source="resend" data-mail-id="${escape(d.provider_message_id)}">Vérifier le statut du mail →</button>` : ""}
      </div></li>`).join("") ?? ""}${downloadRows(service?.downloads ?? [])}</ol>
    ${!service?.deliveries.length ? '<p class="fine">Pas de suivi de livraison conservé pour cet achat ancien. Cela ne signifie pas que le fichier n’a pas été envoyé.</p>' : ""}
    <p class="source-note">Resend peut accepter un mail avant sa remise au destinataire. Le statut actualisé est consultable dans le message. Les traces de liens couvrent au plus 180 jours, à partir de leur mise en place ; elles ne prouvent ni la réception complète ni l’ouverture du fichier. L’utilisation d’un lien ne permet pas d’identifier la personne qui l’ouvre.</p></details>`;
}

export function renderAccountDownloads(rows: DownloadActivity[] = []): string {
  return `<section class="panel"><div class="panel-heading"><h2>Accès aux fichiers depuis le compte</h2></div>
    ${rows.length ? `<ol class="service-timeline">${downloadRows(rows)}</ol>` : '<p class="fine">Aucune trace conservée dans ce nouveau suivi.</p>'}
    <p class="source-note">Au plus 30 liens récents sur 180 jours. L’émission fournit un accès direct au fichier ; son utilisation chez le stockage n’est pas mesurée. Seule l’utilisation du lien de partage est datée ici. Ces accès ne sont pas attribués à un achat particulier lorsque plusieurs achats donnent le même droit.</p></section>`;
}
