/**
 * Clés de jointure normalisées des jeux ouverts du moteur générique (tâche osd.jeux, piste G du
 * plan `2026-10-07-moteur-jeux-ouverts.md`, G1 et G2).
 *
 * Ensemble FERMÉ de cinq clés (plan) : `canton`, `commune_bfs`, `postal_code`, `noga`, `year`.
 * `normalizeDatasetKeyValue` est PARTAGÉE entre l'écriture (`scripts/sync-datasets.ts`, qui
 * normalise chaque ligne avant de l'écrire) et la lecture (`src/routes/api-v1.ts`, qui normalise
 * la valeur de filtre reçue en requête) — la MÊME fonction des deux côtés, pour ne jamais
 * diverger entre ce qui est écrit et ce qui est cherché (même principe que `normalizeStreetName`
 * dans `src/mcp/data-loader.ts`, utilisée à la fois pour construire l'index et pour chercher
 * dedans).
 *
 * Une valeur qui ne respecte pas la forme attendue est REJETÉE (`null`), jamais corrigée par
 * approximation : le collecteur fait alors échouer le jeu entier (ligne invalide, voir le
 * commentaire d'en-tête de `scripts/sync-datasets.ts`) ; l'API répond 400 (valeur de filtre
 * invalide), jamais un filtre silencieusement ignoré.
 */

export const DATASET_KEY_NAMES = ["canton", "commune_bfs", "postal_code", "noga", "year"] as const;
export type DatasetKeyName = (typeof DATASET_KEY_NAMES)[number];

export function isDatasetKeyName(value: string): value is DatasetKeyName {
  return (DATASET_KEY_NAMES as readonly string[]).includes(value);
}

// Même liste que `SWISS_CANTON_ABBREVIATIONS` (`src/lib/canton-profile.ts`) et `SWISS_CANTONS`
// (`scripts/sync-streets.ts`/`sync-bfe-pv.ts`), dupliquée ici volontairement — même style que ces
// fichiers, qui ne la partagent pas davantage entre eux.
const SWISS_CANTONS = new Set([
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
  "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH",
]);

function normalizeCanton(raw: string): string | null {
  const v = raw.normalize("NFC").trim().toUpperCase();
  return SWISS_CANTONS.has(v) ? v : null;
}

/** Numéro OFS de commune : entier, zéros de tête retirés (jamais de division/arrondi — une
 *  manipulation purement textuelle, pour ne jamais risquer un arrondi sur un grand nombre). */
function normalizeCommuneBfs(raw: string): string | null {
  const v = raw.trim();
  if (!/^\d{1,6}$/.test(v)) return null;
  const stripped = v.replace(/^0+(?=\d)/, "");
  return stripped;
}

function normalizePostalCode(raw: string): string | null {
  const v = raw.trim();
  return /^\d{4}$/.test(v) ? v : null;
}

function normalizeYear(raw: string): string | null {
  const v = raw.trim();
  return /^\d{4}$/.test(v) ? v : null;
}

/** Code NOGA : aucun format unique officiel entre les jeux (genre à 6 chiffres, classe à 4,
 *  parfois pointée) — seulement un texte non vide, trim seul. Jamais une forme devinée. */
function normalizeNoga(raw: string): string | null {
  const v = raw.trim();
  return v.length > 0 ? v : null;
}

/** Normalise une valeur brute pour une clé donnée ; `null` = valeur invalide pour cette clé.
 *  Fonction pure, sans E/S, testée directement. */
export function normalizeDatasetKeyValue(key: DatasetKeyName, raw: string): string | null {
  switch (key) {
    case "canton": return normalizeCanton(raw);
    case "commune_bfs": return normalizeCommuneBfs(raw);
    case "postal_code": return normalizePostalCode(raw);
    case "year": return normalizeYear(raw);
    case "noga": return normalizeNoga(raw);
    default: return null;
  }
}
