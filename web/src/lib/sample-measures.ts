import type { SampleMeasures } from '../../../src/lib/sample-measures';

const n = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('fr-CH').format(value);
const date = (value: number) => new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' }).format(value);
const labels = { finma: 'FINMA', tares: 'TARES', classifications: 'Classifications' };

export function renderSampleMeasures(samples: SampleMeasures | null | undefined): string {
  if (!samples) return '<section class="panel order-journey" id="sample-measures"><h2>Demandes d’échantillons</h2><p>Lecture des mesures indisponible. Actualisez pour réessayer.</p></section>';
  const t = samples.total;
  return `<section class="panel order-journey" id="sample-measures" aria-labelledby="sample-measures-title">
    <div class="panel-heading"><div><h2 id="sample-measures-title">Demandes d’échantillons</h2><p>Réponses CSV réussies dans la période choisie. Une nouvelle demande compte à chaque fois.</p></div></div>
    <div class="journey-summary">
      <div><span class="journey-number">${n(t.browser_requests)}</span><strong>demandes de navigateurs présumés</strong><span>Ordinateurs et mobiles déclarés ; sans preuve de présence humaine.</span></div>
      <div><span class="journey-number">${n(t.browser_visitor_days)}</span><strong>visiteurs-jours estimés</strong><span>${t.unidentified_browser_requests ? `${n(t.unidentified_browser_requests)} ${t.unidentified_browser_requests === 1 ? 'demande de navigateur' : 'demandes de navigateurs'} sans identifiant exploitable.` : 'Sur les identifiants quotidiens disponibles.'}</span></div>
      <div><span class="journey-number">${n(t.requests)}</span><strong>demandes servies au total</strong><span>Y compris robots, outils automatisés et agents non classés.</span></div>
    </div>
    ${t.requests === 0 ? '<p class="empty">Aucune demande d’échantillon conservée dans cette sélection. Cela ne prouve pas une absence de demande avant le début de ce suivi ou pendant une perte de mesure.</p>' : ''}
    <p class="fine sample-scroll-help">Faites glisser le tableau pour voir les robots, les outils et les totaux.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Demandes d’échantillons par produit">
      <table><caption class="sr-only">Réponses CSV réussies, par produit et type d’agent déclaré</caption>
        <thead><tr><th scope="col">Produit</th><th scope="col">Navigateurs</th><th scope="col">Visiteurs-jours</th><th scope="col">Robots</th><th scope="col">Outils</th><th scope="col">Non classés</th><th scope="col">Total</th></tr></thead>
        <tbody>${samples.products.map(p => `<tr><th scope="row">${labels[p.dataset]}</th><td>${n(p.browser_requests)}</td><td>${n(p.browser_visitor_days)}</td><td>${n(p.bot_requests)}</td><td>${n(p.automation_requests)}</td><td>${n(p.unclassified_requests)}</td><td>${n(p.requests)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <details class="journey-details"><summary>Comprendre ces mesures</summary>
      <p class="fine">Un HTTP 200 confirme que le serveur a préparé l’échantillon. Il ne prouve ni sa réception complète, ni son ouverture. Les lectures JSON de la fiche produit et les requêtes HEAD sont exclues.</p>
      <p class="fine">Les identifiants changent à minuit en Suisse. Une personne peut compter plusieurs fois sur la période ; plusieurs personnes peuvent partager un identifiant. Le total est dédupliqué entre les produits : il peut être inférieur à la somme des lignes. « — » indique des demandes sans identifiant exploitable.</p>
      <p class="fine">Aucune identité client ni vente n’est rattachée à ces demandes. Les robots peuvent se déclarer navigateurs. Les contrôles techniques du site peuvent apparaître parmi les outils automatisés.</p>
    </details>
    <p class="source-note">Traces conservées ${samples.retention_days} jours au maximum. Période effectivement lue depuis le ${date(samples.effective_since)}. ${samples.first_retained_event === null ? 'Aucune première trace conservée.' : `Première trace d’échantillon encore conservée : ${date(samples.first_retained_event)} ; ce n’est pas une date d’activation.`} L’historique antérieur n’est pas reconstitué. La collecte peut perdre des traces ; son état figure ci-dessous.</p>
  </section>`;
}
