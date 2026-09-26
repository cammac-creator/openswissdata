import type { CleanupProof, CleanupEntry } from '../../../src/lib/cleanup-types';

const labels: Record<CleanupEntry['name'], string> = {
  magic_links: 'Anciens liens de connexion', sessions: 'Liens de connexion et sessions', download_tokens: 'Liens de livraison',
  mcp_oauth_codes: 'Codes de connexion MCP', request_log: 'Ancien journal des requêtes', events: 'Événements statistiques',
  download_activity: 'Traces des liens de téléchargement', delivery_message_references: 'Références techniques des mails',
  bronze_dashboard: 'Copies techniques du CRM', bronze_financial: 'Copies du rapprochement financier', cleanup_proof: 'Enregistrement du contrôle',
};
type Schedule = { active: boolean; failedAt?: number };
export function cleanupSchedule(workflows: { available: boolean; items?: Array<{ id: number; state: string; html_url: string }>; runs?: Array<{ workflow_id: number; created_at: string; status: string; conclusion: string | null }> }): Schedule | undefined {
  if (!workflows.available) return undefined;
  const flow = workflows.items?.find(f => f.html_url.endsWith('/cleanup-expired.yml'));
  if (!flow) return { active: false };
  const run = workflows.runs?.find(r => r.workflow_id === flow.id);
  return { active: flow.state === 'active', ...(run?.status === 'completed' && run.conclusion !== 'success' ? { failedAt: Date.parse(run.created_at) } : {}) };
}
export function renderCleanupStatus(proof: CleanupProof | null | undefined, now = Date.now(), schedule?: Schedule): string {
  const age = proof ? now - proof.checked_at : Infinity;
  const recent = age >= 0 && age < 14 * 3_600_000;
  const laterFailure = schedule?.failedAt !== undefined && schedule.failedAt > (proof?.checked_at ?? 0);
  const healthy = proof?.ok && recent && schedule?.active !== false && !laterFailure;
  const external = schedule?.active === false ? 'Le déclencheur GitHub est absent ou désactivé. Il reste à réactiver, même après un nettoyage serveur réussi.' : laterFailure ? 'Le dernier déclenchement GitHub a échoué et reste à vérifier.' : 'GitHub est aussi prévu comme déclencheur toutes les six heures.';
  const title = schedule?.active === false ? 'Contrôle extérieur à réactiver' : laterFailure ? 'Contrôle extérieur en échec' : !proof ? 'Nettoyage à confirmer' : !proof.ok ? 'Nettoyage incomplet' : !recent ? 'Nettoyage à revérifier' : 'Nettoyage périodique vérifié';
  const date = proof ? new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(proof.checked_at) : null;
  const rows = proof?.entries.map(entry => {
    const label = Object.hasOwn(labels, entry.name) ? labels[entry.name] : 'Catégorie technique';
    const count = Number.isSafeInteger(entry.deleted) && entry.deleted >= 0 ? entry.deleted : 0;
    const plural = count > 1 ? 's' : '';
    const noun = entry.unit === 'folders' ? `dossier${plural}` : entry.unit === 'references' ? `référence${plural}` : `ligne${plural}`;
    const removed = `${count} ${noun} retiré${entry.unit === 'folders' ? '' : 'e'}${plural}`;
    const detail = entry.status === 'error' ? `Échec à vérifier${count ? ` · ${removed}` : ''}` : entry.status === 'not_applicable' ? (entry.unit === 'folders' ? 'Pas de dossier de copies à contrôler' : 'Ancienne table absente · aucun contenu à purger') : count ? removed : 'Rien à retirer lors de ce passage.';
    return `<div class="health-row"><div class="health-icon ${entry.status === 'error' ? 'amber' : ''}">${entry.status === 'error' ? '!' : '✓'}</div><div class="health-copy"><strong>${label}</strong><p>${detail}</p></div></div>`;
  }).join('') ?? '';
  return `<section class="panel" style="margin-bottom:24px"><div class="panel-heading"><div><h2>${title}</h2><p>${date ? `Dernier témoin conservé : ${date} · heure suisse.` : 'Aucun témoin complet disponible.'}</p></div><span class="pill ${healthy ? 'green' : 'amber'}">${healthy ? 'Vérifié' : 'À vérifier'}</span></div><p class="fine">Le serveur vérifie tous les quarts d’heure si un nettoyage est dû, avec un objectif de six heures entre deux passages réussis. Les copies techniques sont purgées même sans visite du bureau ; si GitHub est désactivé, la minuterie du serveur continue.</p><p class="fine">${external}</p>${proof ? `<details style="margin-top:16px"><summary>Voir les catégories contrôlées</summary>${rows}</details>` : ''}<p class="source-note">Une panne du serveur suspend sa minuterie. Après un échec, nouvel essai serveur dans une heure tant que le processus reste actif. Les commandes, preuves contractuelles, droits d’accès, notes et courriers originaux ne sont pas supprimés par ce nettoyage. Les sauvegardes ont leur propre cycle de conservation.</p></section>`;
}
