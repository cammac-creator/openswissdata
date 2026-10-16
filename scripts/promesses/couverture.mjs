// Promesse « historique FINMA » qui suit la fenêtre glissante (décision d6 de Claude-Alain, 16.10.2026).
// L'historique servi couvre environ 90 jours : un seuil fixe de versions rougit à tort tant qu'un trou connu
// reste dans la fenêtre (13.10.2026 : 60 versions pour un seuil de 61, aucune perte). On attend donc une
// version par jour couvert, moins les jours des trous déclarés, à `tolerance_jours` près : le détecteur de
// trous (etl/finma/history.ts) ne signale qu'un écart de plus de deux jours, un jour isolé manquant n'y figure
// pas. La fenêtre doit aussi rester longue d'au moins `fenetre_min_jours` : un historique raccourci, ce que le
// seuil fixe attrapait, reste rouge. Les nouveaux trous sont gardés par la promesse finma-historique-continu.
const JOUR = 86_400_000;
const date = texte => Date.parse(String(texte).slice(0, 10).replaceAll('.', '-'));

export function couvertureTenue(historique, regle) {
  const { tolerance_jours: tolerance, fenetre_min_jours: fenetreMin } = regle ?? {};
  if (!Number.isInteger(tolerance) || tolerance < 0 || !Number.isInteger(fenetreMin) || fenetreMin < 1) {
    return { ok: false, detail: 'règle de couverture invalide' };
  }
  if (!historique || typeof historique !== 'object') return { ok: false, detail: 'historique absent' };
  const { available_from: debut, available_until: fin, snapshots, gaps } = historique;
  const t0 = date(debut), t1 = date(fin);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return { ok: false, detail: 'dates de couverture illisibles' };
  if (!Number.isInteger(snapshots) || !Array.isArray(gaps)) return { ok: false, detail: 'versions ou trous illisibles' };
  const fenetre = Math.round((t1 - t0) / JOUR);
  if (fenetre < fenetreMin) return { ok: false, detail: `fenêtre de ${fenetre} jours (attendu au moins ${fenetreMin})` };
  let manquants = 0;
  for (const trou of gaps) {
    if (!trou || typeof trou.days !== 'number' || !Number.isFinite(trou.days) || trou.days < 1) {
      return { ok: false, detail: 'trou illisible' };
    }
    manquants += Math.round(trou.days) - 1;
  }
  const attendu = fenetre + 1 - manquants - tolerance;
  return snapshots >= attendu
    ? { ok: true, detail: `${snapshots} versions pour ${attendu} attendues` }
    : { ok: false, detail: `${snapshots} versions pour ${attendu} attendues (${fenetre + 1} jours couverts, ${manquants} jours de trous connus, tolérance ${tolerance})` };
}
