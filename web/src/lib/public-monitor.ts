type Flow = { id: number; path?: string; state: string };
type Run = { id: number; workflow_id: number; head_branch?: string; event?: string; run_attempt?: number; status: string; conclusion: string | null; created_at: string; updated_at?: string };
type Source = { available: boolean; checked_at?: number; items?: Flow[]; runs?: Run[]; history?: { unavailable?: number[]; not_requested?: number[] } };
const PATH = '.github/workflows/monitor-public.yml';
const URL = 'https://github.com/cammac-creator/openswissdata/actions/workflows/monitor-public.yml';
const stamp = (value: string | undefined) => value ? Date.parse(value) : NaN;
const date = (value: string | undefined) => Number.isFinite(stamp(value)) ? new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' }).format(stamp(value)) : 'date non vérifiée';

export function publicMonitorStatus(source: Source, now = Date.now()) {
  const pending = (label: string, detail: string) => ({ healthy: false, label, detail });
  if (!source.available || !Number.isFinite(source.checked_at) || now - source.checked_at! < 0 || now - source.checked_at! > 1_200_000) return pending('Lecture à renouveler', 'L’état GitHub est indisponible ou a été lu il y a plus de vingt minutes. Utilisez Actualiser.');
  const flow = source.items?.find(item => item.path === PATH);
  if (!flow) return pending('Installation non confirmée', 'La tâche extérieure n’est pas présente dans la liste consultée.');
  if (flow.state !== 'active') return pending('Surveillance suspendue', 'GitHub indique une tâche désactivée. Un ancien succès ne confirme pas sa reprise.');
  const runs = (source.runs ?? []).filter(run => run.workflow_id === flow.id && run.head_branch === 'main');
  if (runs.some(run => !Number.isFinite(stamp(run.created_at)) || stamp(run.created_at) > now)) return pending('Date à vérifier', 'Un passage porte une date absente, invalide ou future.');
  runs.sort((a, b) => stamp(b.created_at) - stamp(a.created_at) || b.id - a.id);
  const latest = runs[0], scheduled = runs.find(run => run.event === 'schedule');
  if (!latest && source.history?.unavailable?.includes(flow.id)) return pending('Historique indisponible', 'La lecture des passages de cette tâche a échoué. Aucun premier passage ni succès n’est déduit.');
  if (!latest && source.history?.not_requested?.includes(flow.id)) return pending('Historique non consulté', 'La limite des recherches complémentaires est atteinte. Consultez les exécutions de cette tâche dans GitHub.');
  if (!latest) return pending('Premier contrôle attendu', 'Aucun passage sur main dans les cent dernières exécutions consultées.');
  if (latest.status !== 'completed') return pending('Contrôle en attente', 'Le dernier passage n’est pas terminé. Aucun succès n’est encore confirmé.');
  if (latest.conclusion !== 'success') return pending('Dernier contrôle à vérifier', 'Le dernier passage est en échec, annulé ou incomplet. Consultez son détail dans GitHub.');
  if (!scheduled) return pending('Premier passage automatique attendu', `Contrôle ponctuel réussi le ${date(latest.created_at)} ; aucune exécution horaire automatique encore observée.`);
  if (scheduled.run_attempt !== 1) return pending('Passage horaire relancé ou à confirmer', 'La dernière exécution horaire a été relancée ou son numéro de tentative manque. Une intervention manuelle ne prouve pas un passage automatique réussi.');
  if (now - stamp(scheduled.created_at) > 150 * 60_000) return pending('Passage automatique ancien', `Dernier lancement horaire observé le ${date(scheduled.created_at)}. Un contrôle manuel ne remplace pas la cadence automatique.`);
  if (scheduled.status !== 'completed' || scheduled.conclusion !== 'success') return pending('Passage automatique à vérifier', 'Le dernier lancement horaire n’a pas de succès confirmé, même si un contrôle ponctuel a réussi depuis.');
  for (const run of [latest, scheduled]) {
    if (!Number.isFinite(stamp(run.updated_at)) || stamp(run.updated_at) < stamp(run.created_at) || stamp(run.updated_at) > now) return pending('Fin de contrôle à vérifier', 'La date du résultat reçu n’est pas cohérente.');
  }
  return { healthy: true, label: 'Passage automatique récent', detail: `Contrôle horaire réussi, lancé le ${date(scheduled.created_at)}. Dernier résultat enregistré le ${date(latest.updated_at)} · heure suisse.` };
}

export function renderPublicMonitor(source: Source, now = Date.now()) {
  const state = publicMonitorStatus(source, now);
  return `<section class="panel" id="public-monitor" style="margin-bottom:24px"><div class="panel-heading"><div><h2>Surveillance extérieure du site</h2><p>Un contrôle depuis GitHub, indépendant du Mac et du serveur.</p></div><span class="pill ${state.healthy ? 'green' : 'amber'}">${state.label}</span></div><p>${state.detail}</p><p class="fine">À la minute 23 de chaque heure : disponibilité du site et de la base, puis âge de l’édition FINMA (moins de 72 heures depuis minuit UTC de sa date). Aucun accès client, paiement, mail ou sauvegarde n’est déclenché.</p><a class="button secondary" href="${URL}" target="_blank" rel="noopener">Voir les contrôles extérieurs ↗</a><p class="source-note">État au ${date(new Date(now).toISOString())} · heure suisse du serveur. Lecture ponctuelle, mise en cache dix minutes ; Actualiser relit les informations disponibles. Une absence de passage pendant 2 h 30 demande vérification. GitHub peut retarder ou omettre une exécution et désactive les tâches planifiées après 60 jours sans activité du dépôt public. Les résultats et échecs sont visibles dans GitHub ; la réception d’une notification n’est pas vérifiée. Ce contrôle ne remplace pas la surveillance privée des sauvegardes et des livraisons, qui dépend encore du Mac.</p></section>`;
}
