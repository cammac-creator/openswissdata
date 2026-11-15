/**
 * Liste blanche des formes juridiques de personnes morales, partagée par l'assemblage de la fiche
 * (`check.ts` : adresse et but) et par la lecture du registre IDE (`uid-register.ts` : inscription
 * au registre TVA). Un seul exemplaire, pour que les deux portes ne puissent jamais diverger.
 * Déplacée telle quelle depuis `check.ts` le 15.11.2026 ; `check.ts` la réexporte.
 */

// Liste BLANCHE des formes juridiques eCH-0097 de personnes morales, relevée le 06.10.2026
// dans le vocabulaire officiel de LINDAS (relecture finale, tâche osd.fiche). SEULES ces
// formes ouvrent l'adresse postale (rue, NPA, localité) ET le but (`purpose`) : une raison
// sociale de personne morale ne porte normalement pas le nom d'une personne physique,
// contrairement à une entreprise individuelle ("0101"), une société en nom collectif
// ("0103"), une société en commandite ("0104") ou une société en commandite par actions
// ("0105"), dont la raison sociale PEUT légalement contenir un nom de famille. Tout autre
// code (dont "0111", "0113", "0118", "0119", "0151", "0571") ou code absent/inconnu ferme
// aussi l'adresse et le but : une forme non reconnue n'écarte jamais la possibilité d'une
// entreprise individuelle ou assimilée.
// Exportée (tâche osd.donnees, tâche B4) : `scripts/sync-finma-seats.ts` réutilise cette MÊME
// liste blanche pour ne garder, dans `finma_seats.csv`, que les sièges de personnes morales —
// jamais une copie, pour ne jamais diverger de la porte appliquée ici.
export const ADDRESS_AND_PURPOSE_FORM_CODES = new Set<string>([
  "0106", // société anonyme (SA)
  "0107", // société à responsabilité limitée (Sàrl)
  "0108", // société coopérative
  "0109", // association
  "0110", // fondation
  "0114", // société en commandite de placements collectifs
  "0115", // société d'investissement à capital variable (SICAV)
  "0116", // société d'investissement à capital fixe (SICAF)
  "0117", // institut de droit public
  "0220", "0221", "0222", "0223", "0224", // administrations publiques
  "0230", "0231", "0232", "0233", "0234", // entreprises publiques
  "0329", // organisation internationale
]);
