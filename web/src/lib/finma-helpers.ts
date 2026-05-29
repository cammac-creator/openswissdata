/**
 * FINMA registry helpers — entités SOUS SURVEILLANCE et AUTORISÉES uniquement.
 * Données : web/src/data/finma.json (généré depuis le registre FINMA public,
 * entités sur liste d'avertissement EXCLUES). Lecture au build (SSG).
 */
import data from "../data/finma.json";

export interface FinmaEntity {
  slug: string;
  name: string;
  uid: string;
  lei: string;
  type: string;
  lic: string;
  lic_fr: string;
  lic_de: string;
  lic_it: string;
  date: string;
  canton: string;
  city: string;
  src: string;
}

let _all: FinmaEntity[] | null = null;
export function loadFinma(): FinmaEntity[] {
  if (!_all) _all = data as FinmaEntity[];
  return _all;
}

export function getEntityBySlug(slug: string): FinmaEntity | undefined {
  return loadFinma().find((e) => e.slug === slug);
}

// Ordre d'affichage des types (du plus "grand public" au plus niche).
export const TYPE_ORDER = [
  "bank",
  "insurance",
  "securities_firm",
  "asset_manager_collective",
  "asset_manager_individual",
  "fund_representative",
  "infrastructure",
  "fintech",
  "supervisory_org",
] as const;

export function entitiesByType(): Map<string, FinmaEntity[]> {
  const m = new Map<string, FinmaEntity[]>();
  for (const e of loadFinma()) {
    const arr = m.get(e.type);
    if (arr) arr.push(e);
    else m.set(e.type, [e]);
  }
  return m;
}

export function typeCounts(): Array<{ type: string; count: number }> {
  const m = entitiesByType();
  return TYPE_ORDER.filter((t) => m.has(t)).map((t) => ({ type: t, count: m.get(t)!.length }));
}

/** Autres entités du même type (pour le maillage interne), hors l'entité courante. */
export function neighborsOfType(entity: FinmaEntity, limit = 10): FinmaEntity[] {
  return loadFinma()
    .filter((e) => e.type === entity.type && e.slug !== entity.slug)
    .slice(0, limit);
}
