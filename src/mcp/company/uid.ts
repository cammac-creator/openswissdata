/**
 * Numéro d'identification des entreprises (IDE / UID) : lecture et chiffre de contrôle.
 *
 * Forme canonique `CHE-xxx.xxx.xxx`. Le neuvième chiffre est un contrôle modulo 11 : poids
 * 5,4,3,2,7,6,5,4 sur les huit premiers chiffres, contrôle = 11 − (somme mod 11) ; 11 donne 0 et
 * 10 rend le numéro invalide. Un numéro refusé ici ne part jamais vers une source (tâche osd.fiche).
 */

export type ParsedUid = { ok: true; uid: string; compact: string } | { ok: false; reason: string };

const POIDS = [5, 4, 3, 2, 7, 6, 5, 4] as const;

export function parseUid(raw: string): ParsedUid {
  const sansSeparateurs = raw.trim().toUpperCase().replace(/[\s.\-]/g, "");
  const chiffres = sansSeparateurs.startsWith("CHE") ? sansSeparateurs.slice(3) : sansSeparateurs;
  if (!/^\d{9}$/.test(chiffres)) {
    return { ok: false, reason: "a Swiss UID has the form CHE-xxx.xxx.xxx (nine digits)" };
  }
  const somme = POIDS.reduce((total, poids, i) => total + poids * Number(chiffres[i]), 0);
  const reste = 11 - (somme % 11);
  const controle = reste === 11 ? 0 : reste;
  if (controle === 10 || controle !== Number(chiffres[8])) {
    return { ok: false, reason: "invalid UID check digit" };
  }
  const uid = `CHE-${chiffres.slice(0, 3)}.${chiffres.slice(3, 6)}.${chiffres.slice(6, 9)}`;
  return { ok: true, uid, compact: `CHE${chiffres}` };
}
