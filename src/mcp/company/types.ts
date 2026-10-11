/**
 * Types communs aux clients en direct de la fiche société (LINDAS, GLEIF et, depuis le
 * 11.10.2026, l'API REST Zefix pour le seul statut d'inscription).
 *
 * Importés par `lindas.ts`, `gleif.ts`, `zefix-rest.ts`, `cache.ts` et par la tâche 4 (assemblage de la fiche).
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

/**
 * Statut d'inscription au registre du commerce, normalisé depuis la valeur `status` de l'API
 * REST publique Zefix (OFRC, tâche du 11.10.2026) : `ACTIVE` → `active`, `BEING_CANCELLED` →
 * `in_liquidation`, `CANCELLED` → `deleted`. Toute autre valeur, absente ou inattendue, rend
 * `unknown` : jamais un statut deviné.
 */
export type ZefixRestStatus = "active" | "in_liquidation" | "deleted" | "unknown";

/**
 * Seuls champs gardés d'une réponse Zefix REST (minimisation) : le statut normalisé et la date
 * de radiation (`AAAA-MM-JJ`, ou `null` si absente ou d'une autre forme). La raison sociale,
 * l'adresse et le but que porte aussi la réponse ne sont jamais conservés ici : pour une
 * entreprise individuelle, ce sont des données personnelles que la fiche retient volontairement.
 */
export interface ZefixRestStatusRecord {
  status: ZefixRestStatus;
  deletion_date: string | null;
}
