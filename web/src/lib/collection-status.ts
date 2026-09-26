import type { EventCoverage } from '../../../src/lib/event-budget';

/** Une preuve d’abandon donne un minimum, jamais une estimation des visites perdues. */
export function renderCollectionStatus(proof: EventCoverage): string {
  const unknown = !proof.available || proof.uncertain_before !== null;
  if (!unknown && !proof.gaps.length) return '';
  const count = proof.gaps.reduce((n, gap) => Math.min(Number.MAX_SAFE_INTEGER, n + gap.dropped), 0);
  const nf = new Intl.NumberFormat('fr-CH');
  return `<section class="notice" aria-labelledby="collection-title"><h2 id="collection-title">${proof.gaps.length ? 'Collecte des statistiques incomplète' : 'Historique de collecte à vérifier'}</h2>${proof.gaps.length ? `<p>Au moins ${nf.format(count)} événement(s) non enregistré(s) sont documentés sur ${nf.format(proof.gaps.length)} journée(s) de cette période. Cela peut concerner les pages, les appels API et les événements déclarés. Les chiffres affichés restent ceux des traces conservées.</p>` : ''}${unknown ? '<p>Une partie des preuves de collecte ne peut pas être vérifiée. Les éventuelles pertes ne sont pas toutes quantifiables.</p>' : ''}${proof.pending ? '<p>Une partie de ce relevé attend encore sa sauvegarde.</p>' : ''}<p>Les journées concernées sont signalées dans le tableau des valeurs et, lorsqu’une valeur existe, dans le graphique. Une panne peut empêcher de conserver le dernier relevé ; l’absence de signal ne garantit pas une collecte complète. <a href="#operations">Consulter les automatisations →</a></p></section>`;
}
