/**
 * Sous-ensemble du registre FINMA servi par `/api/v1/finma/licences` (décisions de Claude-Alain
 * du 05.11.2026, point 2, et du 06.11.2026, choix 1 côté IBANforge) : IDE et libellés de
 * l'autorisation, pour les banques, les fintechs et les maisons de titres.
 *
 * Chaque ligne est reconstruite champ par champ : un champ ajouté au registre ne sort pas d'ici
 * sans une décision. La liste d'alerte n'est pas lue. Les libellés restent ceux de la FINMA.
 */

import type { FinmaRegistryRow } from "../mcp/data-loader.js";
import { isCalendarDate } from "./tariff-history.js";

export const FINMA_LICENCE_ENTITY_TYPES: ReadonlySet<string> = new Set(["bank", "fintech", "securities_firm"]);

const UID_FORMAT = /^CHE-\d{3}\.\d{3}\.\d{3}$/;

export interface FinmaLicenceRow {
  uid: string;
  entity_type: string;
  licence_type: string;
  licence_type_de: string;
  licence_type_fr: string;
  licence_type_it: string;
}

/** Une ligne par IDE et par autorisation, dans un ordre stable. `uid.csv` ne porte aucun statut
 *  aujourd'hui (colonne vide) : un statut renseigné autre qu'« active » reste dehors. */
export function finmaLicenceRows(registry: readonly FinmaRegistryRow[]): FinmaLicenceRow[] {
  const byKey = new Map<string, FinmaLicenceRow>();
  for (const row of registry) {
    if (!FINMA_LICENCE_ENTITY_TYPES.has(row.entity_type)) continue;
    if (!UID_FORMAT.test(row.uid) || !row.licence_type) continue;
    if (row.status && row.status !== "active") continue;
    const key = `${row.uid}|${row.licence_type}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      uid: row.uid,
      entity_type: row.entity_type,
      licence_type: row.licence_type,
      licence_type_de: row.licence_type_de,
      licence_type_fr: row.licence_type_fr,
      licence_type_it: row.licence_type_it,
    });
  }
  return [...byKey.values()].sort((a, b) => a.uid.localeCompare(b.uid) || a.licence_type.localeCompare(b.licence_type));
}

/** Date de collecte portée par une version (`2026.11.04` donne `2026-11-04`), comme
 *  `/api/catalog/finma`. `null` si la version ne la porte pas : jamais la date du jour à la place. */
export function finmaCollectedOn(version: string): string | null {
  if (!/^\d{4}\.\d{2}\.\d{2}(?:\D|$)/.test(version)) return null;
  const date = `${version.slice(0, 4)}-${version.slice(5, 7)}-${version.slice(8, 10)}`;
  return isCalendarDate(date) ? date : null;
}
