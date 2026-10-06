/**
 * Types communs aux deux clients en direct de la fiche société (LINDAS, GLEIF).
 *
 * Importés par `lindas.ts`, `gleif.ts`, `cache.ts` et par la tâche 4 (assemblage de la fiche).
 * Aucune logique ici : seulement les formes de données (tâche osd.fiche, tâche 3).
 */

/** Dépendances injectées dans un client en direct : horloge et fetch, jamais lus globalement. */
export interface LiveDeps {
  fetch: typeof fetch;
  now: () => number;
  /** Délai maximal d'une requête, en millisecondes. Défaut 6000 (voir lindas.ts / gleif.ts). */
  timeoutMs?: number;
}

/**
 * Résultat d'une consultation en direct d'une source.
 * `available: false` couvre tout échec (délai, statut HTTP, JSON invalide, forme inattendue) :
 * la raison reste courte et ne contient jamais de corps de réponse brut.
 * `available: true` couvre à la fois « trouvé » (`found: true`, `data` renseigné) et
 * « IDE valide mais absent de la source » (`found: false`, `data: null`).
 */
export type Part<T> =
  | { available: true; retrieved_at: string; found: boolean; data: T | null }
  | { available: false; reason: string };

/** Société telle que lue dans le registre du commerce en données liées (LINDAS, graphe Zefix). */
export interface LindasCompany {
  legal_name: string;
  other_names: string[];
  legal_form_code: string | null;
  legal_form_label_fr: string | null;
  legal_form_label_de: string | null;
  municipality: string | null;
  municipality_bfs_id: string | null;
  canton: string | null;
  street_address: string | null;
  postal_code: string | null;
  locality: string | null;
  purpose: string | null;
  ch_id: string | null;
  register_uri: string;
}

/** Enregistrement LEI tel que lu dans l'API publique de GLEIF. `entity_status` et
 *  `registration_status` : `null` quand GLEIF ne rend pas le statut (jamais une valeur de
 *  repli inventée comme "unknown" — correction 1 du 06.10.2026, tâche osd.fiche, tâche 4). */
export interface GleifRecord {
  lei: string;
  legal_name: string;
  entity_status: string | null;
  registration_status: string | null;
  last_update: string | null;
  registered_as: string | null;
}
