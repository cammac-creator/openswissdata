import type { CleanupProof, CleanupEntry } from '../../../src/lib/cleanup-types';
import type { ReplayResult } from '../../../src/lib/erasure-registry';
export type ErasureReplay = ReplayResult;

const labels: Record<CleanupEntry['name'], string> = {
  delivery_incident_events: 'Historique technique des incidents', delivery_incidents: 'Incidents de livraison clos',
  checkout_request_limits: 'Compteurs temporaires de paiement',
  auth_request_limits: 'Compteurs temporaires de connexion', magic_links: 'Anciens liens de connexion', sessions: 'Liens de connexion et sessions', download_tokens: 'Liens de livraison',
  mcp_oauth_codes: 'Codes de connexion MCP', request_log: 'Ancien journal des requêtes', events: 'Événements statistiques',
  download_activity: 'Traces des liens de téléchargement', delivery_message_references: 'Références techniques des mails',
  bronze_dashboard: 'Copies techniques du CRM', bronze_financial: 'Copies du rapprochement financier', cleanup_proof: 'Enregistrement du contrôle',
  purchase_records: 'Commandes et preuves de plus de dix ans', crm_records: 'Suivi client sans achat ni échange depuis trois ans',
  customer_accounts: 'Comptes sans achat depuis dix ans', erasure_registry: 'Copie du registre des effacements',
};
type Schedule = { active: boolean; failedAt?: number };
export function cleanupSchedule(workflows: { available: boolean; items?: Array<{ id: number; state: string; html_url: string }>; runs?: Array<{ workflow_id: number; created_at: string; status: string; conclusion: string | null }> }): Schedule | undefined {
  if (!workflows.available) return undefined;
  const flow = workflows.items?.find(f => f.html_url.endsWith('/cleanup-expired.yml'));
  if (!flow) return { active: false };
  const run = workflows.runs?.find(r => r.workflow_id === flow.id);
  return { active: flow.state === 'active', ...(run?.status === 'completed' && run.conclusion !== 'success' ? { failedAt: Date.parse(run.created_at) } : {}) };
}
const categoryNames: Record<ReplayResult['deferred_entries'][number]['category'], string> = { purchase_order: 'commande', crm_records: 'suivi du client', customer_account: 'compte' };
/** Dernier contrôle du registre des effacements (démarrage ou nettoyage) : nombres et identifiants internes seulement. */
function renderReplay(replay: ErasureReplay | null | undefined): string {
  if (!replay) return '<p class="fine">Registre des effacements : aucun contrôle enregistré pour le moment.</p>';
  const when = `${new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(replay.checked_at)} (${replay.origin === 'startup' ? 'démarrage' : 'nettoyage'})`;
  if (replay.status === 'suspended') return `<p class="fine">Registre des effacements : réapplication suspendue par OSD_SKIP_ERASURE_REPLAY au contrôle du ${when}. Retirer l’interrupteur une fois l’intervention terminée.</p>`;
  const reapplied = replay.reapplied.purchase_order + replay.reapplied.crm_records + replay.reapplied.customer_account;
  if (replay.status === 'ok') return `<p class="fine">Registre des effacements contrôlé le ${when} : ${reapplied} effacement${reapplied > 1 ? 's' : ''} réappliqué${reapplied > 1 ? 's' : ''}, rien en attente.</p>`;
  const parts = [
    replay.deferred ? `${replay.deferred} entrée${replay.deferred > 1 ? 's' : ''} reportée${replay.deferred > 1 ? 's' : ''} (${replay.deferred_entries.map(entry => `${categoryNames[entry.category]} n° ${entry.subject_id}`).join(', ')})` : '',
    replay.future ? `${replay.future} entrée${replay.future > 1 ? 's' : ''} datée${replay.future > 1 ? 's' : ''} dans le futur, ignorée${replay.future > 1 ? 's' : ''}` : '',
    replay.issues.includes('mirror_unreadable') || replay.issues.includes('registry_path_invalid') ? 'copie hors base illisible, laissée intacte' : '',
    replay.issues.includes('mirror_write_failed') ? 'copie hors base non écrite' : '',
    replay.issues.includes('database_error') ? 'réapplication interrompue par la base' : '',
  ].filter(Boolean);
  return `<p class="fine"><strong>Registre des effacements à examiner</strong> (contrôle du ${when}) : ${parts.join(' · ')}. Le service reste ouvert ; nouvel essai à chaque nettoyage.</p>`;
}
export function renderCleanupStatus(proof: CleanupProof | null | undefined, now = Date.now(), schedule?: Schedule, replay?: ErasureReplay | null): string {
  const age = proof ? now - proof.checked_at : Infinity;
  const recent = age >= 0 && age < 14 * 3_600_000;
  const laterFailure = schedule?.failedAt !== undefined && schedule.failedAt > (proof?.checked_at ?? 0);
  const healthy = proof?.ok && recent && schedule?.active !== false && !laterFailure && (!replay || replay.status === 'ok');
  const external = schedule?.active === false ? 'Le déclencheur GitHub est absent ou désactivé. Il reste à réactiver, même après un nettoyage serveur réussi.' : laterFailure ? 'Le dernier déclenchement GitHub a échoué et reste à vérifier.' : 'GitHub est aussi prévu comme déclencheur toutes les six heures.';
  const title = schedule?.active === false ? 'Contrôle extérieur à réactiver' : laterFailure ? 'Contrôle extérieur en échec' : !proof ? 'Nettoyage à confirmer' : !proof.ok ? 'Nettoyage incomplet' : !recent ? 'Nettoyage à revérifier' : 'Nettoyage périodique vérifié';
  const date = proof ? new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(proof.checked_at) : null;
  const rows = proof?.entries.map(entry => {
    const label = Object.hasOwn(labels, entry.name) ? labels[entry.name] : 'Catégorie technique';
    const count = Number.isSafeInteger(entry.deleted) && entry.deleted >= 0 ? entry.deleted : 0;
    const plural = count > 1 ? 's' : '';
    const noun = entry.unit === 'folders' ? `dossier${plural}` : entry.unit === 'references' ? `référence${plural}` : entry.unit === 'orders' ? `commande${plural}` : entry.unit === 'customers' ? `client${plural}` : `ligne${plural}`;
    const removed = `${count} ${noun} ${entry.unit === 'orders' || entry.unit === 'rows' || entry.unit === 'references' ? `retirée${plural}` : `retiré${plural}`}`;
    const detail = entry.name === 'erasure_registry' ? (entry.status !== 'error' ? 'Copie hors base à jour, réappliquée au démarrage et à chaque nettoyage.'
        : entry.error === 'registry_suspended' ? 'Réapplication suspendue par l’interrupteur d’intervention : à retirer une fois l’intervention terminée.'
        : entry.error === 'replay_pending' ? 'Des effacements restaurés attendent leur réapplication : voir le registre ci-dessous.'
        : entry.error === 'database_error' ? 'Réapplication interrompue par la base : nouvel essai au prochain passage.'
        : 'Copie hors base à vérifier : illisible ou impossible à écrire, un effacement pourrait revenir après une restauration.')
      : entry.status === 'error' ? `Échec à vérifier${count ? ` · ${removed}` : ''}` : entry.status === 'not_applicable' ? (entry.unit === 'folders' ? 'Pas de dossier de copies à contrôler' : 'Ancienne table absente · aucun contenu à purger') : count ? removed : 'Rien à retirer lors de ce passage.';
    return `<div class="health-row"><div class="health-icon ${entry.status === 'error' ? 'amber' : ''}">${entry.status === 'error' ? '!' : '✓'}</div><div class="health-copy"><strong>${label}</strong><p>${detail}</p></div></div>`;
  }).join('') ?? '';
  return `<section class="panel" style="margin-bottom:24px"><div class="panel-heading"><div><h2>${title}</h2><p>${date ? `Dernier témoin conservé : ${date} · heure suisse.` : 'Aucun témoin complet disponible.'}</p></div><span class="pill ${healthy ? 'green' : 'amber'}">${healthy ? 'Vérifié' : 'À vérifier'}</span></div><p class="fine">Le serveur vérifie tous les quarts d’heure si un nettoyage est dû, avec un objectif de six heures entre deux passages réussis. Les copies techniques sont purgées même sans visite du bureau ; si GitHub est désactivé, la minuterie du serveur continue.</p><p class="fine">${external}</p>${renderReplay(replay)}${proof ? `<details style="margin-top:16px"><summary>Voir les catégories contrôlées</summary>${rows}</details>` : ''}<p class="source-note">Une panne du serveur suspend sa minuterie. Après un échec, nouvel essai serveur dans une heure tant que le processus reste actif. Commandes et preuves réglées : effacées dix ans après la fin de l’année d’achat. Notes, fiches et actions : trois ans après le dernier achat ou échange connu, jamais pendant une action ou un incident ouvert. Comptes : après dix ans sans achat, une fois le reste effacé. Chaque effacement est inscrit dans un registre sans donnée personnelle, rejoué au démarrage après une restauration. Les courriers originaux restent chez leurs fournisseurs ; les sauvegardes ont leur propre cycle de conservation.</p></section>`;
}
