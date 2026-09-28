/**
 * Classement de noms partagé par kyc_check et finma_search.
 *
 * Rang d'un nom pour la requête (plus petit = meilleur) : égalité, début sur un mot entier,
 * mot entier ailleurs, début de nom, simple sous-chaîne, puis tous les mots dans un autre ordre.
 * Sans cela, « UBS » plaçait « Clos du Doubs » avant UBS Switzerland AG, et une requête large
 * gardait les premières lignes du registre au lieu des meilleures.
 */

/** Minuscules et accents retirés : « Zürcher » → « zurcher ». */
export function foldName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const MATCH_RANKS = ["exact", "word_start", "whole_word", "prefix", "substring", "all_words"] as const;

/** Rang de 0 (égalité) à 5 (tous les mots, autre ordre) ; `null` si aucune correspondance. */
export function nameMatcher(needle: string): (candidate: string) => number | null {
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`, "u");
  // Mots distincts, huit au plus : le repli reste borné quelle que soit la requête.
  const tokens = [...new Set(needle.split(/\s+/).filter((t) => t.length >= 2))].slice(0, 8);
  return (candidate) => {
    if (candidate === needle) return 0;
    if (candidate.includes(needle)) {
      if (candidate.startsWith(needle) && word.test(candidate)) return 1;
      if (word.test(candidate)) return 2;
      return candidate.startsWith(needle) ? 3 : 4;
    }
    // Mots dans un autre ordre (« Morges Raiffeisen ») : tous les mots présents.
    if (tokens.length > 1 && tokens.every((t) => candidate.includes(t))) return 5;
    return null;
  };
}

/** Lignes correspondantes, de la plus proche à la plus lointaine ; ordre du registre à rang égal. */
export function rankedMatches<T extends { name: string }>(rows: readonly T[], needle: string): T[] {
  const rank = nameMatcher(needle);
  return rows
    .map((row, index) => ({ row, index, score: rank(foldName(row.name)) }))
    .filter((m): m is { row: T; index: number; score: number } => m.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((m) => m.row);
}
