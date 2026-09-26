import type { CheckoutMeasures } from '../../../src/lib/checkout-measures';

const n = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('fr-CH').format(value);
const date = (value: number) => new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' }).format(value);
const baskets = { finma: 'FINMA', tares: 'TARES', classifications: 'Classifications', bundle: 'Bundle · trois fichiers', mixed: 'Plusieurs fichiers à l’unité' };
const locales = { fr: 'Français', de: 'Allemand', en: 'Anglais' };

export function renderCheckoutMeasures(measures: CheckoutMeasures | null | undefined): string {
  if (!measures) return '<section class="panel order-journey" id="checkout-measures"><h2>Sessions de paiement créées</h2><p>Lecture des créations indisponible. Actualisez pour réessayer.</p></section>';
  const t = measures.total;
  return `<section class="panel order-journey" id="checkout-measures" aria-labelledby="checkout-measures-title">
    <div class="panel-heading"><div><h2 id="checkout-measures-title">Sessions de paiement créées</h2><p>Créations de sessions en mode réel confirmées par Stripe, pour les achats de fichiers.</p></div></div>
    <div class="journey-summary">
      <div><span class="journey-number">${n(t.sessions)}</span><strong>créations observées</strong><span>Formulaire du site et API, toutes classes d’agents confondues.</span></div>
      <div><span class="journey-number">${n(t.browser_sessions)}</span><strong>depuis des navigateurs présumés</strong><span>Une création ne prouve pas l’affichage de la page Stripe, ni un paiement.</span></div>
      <div><span class="journey-number">${n(t.browser_visitor_days)}</span><strong>visiteurs-jours estimés</strong><span>${t.unidentified_browser_sessions ? `${n(t.unidentified_browser_sessions)} ${t.unidentified_browser_sessions === 1 ? 'création sans identifiant exploitable' : 'créations sans identifiant exploitable'}.` : 'Identifiants quotidiens disponibles, sans identité client.'}</span></div>
    </div>
    ${t.sessions === 0 ? '<p class="empty">Aucune création conservée dans cette sélection. Les anciens parcours et les pertes de mesure ne sont pas reconstitués.</p>' : ''}
    <div class="table-wrap" tabindex="0" role="region" aria-label="Créations de paiement par panier">
      <table><caption class="sr-only">Créations observées par type de panier, toutes classes d’agents</caption><thead><tr><th scope="col">Panier</th><th scope="col">Créations</th></tr></thead>
      <tbody>${measures.baskets.map(row => `<tr><th scope="row">${baskets[row.basket]}</th><td>${n(row.sessions)}</td></tr>`).join('')}</tbody></table>
    </div>
    <details class="journey-details"><summary>Origine, langue et limites</summary>
      <div class="grid-equal"><div><h3>Point d’entrée</h3><dl class="journey-breakdown">${measures.entries.map(row => `<div><dt>${row.entry === 'form' ? 'Formulaire du site' : 'API'}</dt><dd>${n(row.sessions)}</dd></div>`).join('')}</dl></div>
      <div><h3>Langue de la page d’achat</h3><dl class="journey-breakdown">${measures.locales.map(row => `<div><dt>${locales[row.locale]}</dt><dd>${n(row.sessions)}</dd></div>`).join('')}</dl><p class="fine">Français par défaut si la demande ne précise rien. Ce n’est pas une préférence client confirmée.</p></div></div>
      <p class="fine">Autres agents déclarés : ${n(t.bot_sessions)} robots, ${n(t.automation_sessions)} outils automatisés et ${n(t.unclassified_sessions)} non classés. Un robot peut se déclarer navigateur.</p>
      <p class="fine">Des demandes répétées peuvent créer plusieurs sessions pour une même personne. Les sessions de test, les abonnements et les échecs sans confirmation ne sont pas comptés. Une réponse perdue après création chez Stripe peut manquer à ce suivi.</p>
      <p class="fine">Le bundle compte une création. Un panier de plusieurs fichiers à l’unité est classé séparément. Les visiteurs-jours changent à minuit en Suisse, sans correspondre à des personnes uniques sur la période. Aucun client, abandon ou taux de conversion n’est déduit.</p>
    </details>
    <p class="source-note">Ces créations ne sont reliées ni aux échantillons ni aux commandes affichées après achat. Traces conservées ${measures.retention_days} jours au maximum, lues depuis le ${date(measures.effective_since)}. ${measures.first_retained_event === null ? 'Aucune première trace conservée.' : `Première trace encore conservée : ${date(measures.first_retained_event)}, sans preuve d’activation à cette date.`} Collecte facultative : voir son état ci-dessous.</p>
  </section>`;
}
