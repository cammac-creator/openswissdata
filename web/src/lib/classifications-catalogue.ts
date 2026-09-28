import { readPublicCatalogue } from './public-catalogue';

export const SCHEME_IDS = ['NOGA_2008', 'NOGA_2025', 'NACE_2.0', 'NACE_2.1', 'ISIC_4'] as const;
export type SchemeId = typeof SCHEME_IDS[number];
export const LEVELS = ['section', 'division', 'group', 'class', 'subclass'] as const;
export type Level = typeof LEVELS[number];

export interface ClassificationSampleRow {
  scheme: SchemeId;
  code: string;
  level: Level;
  parent: string | null;
  label_fr?: string;
  label_de?: string;
  label_it?: string;
  label_en?: string;
  label_es?: string;
}
export interface ClassificationsCatalogue {
  version: string;
  checked_at: string;
  rows: number;
  links: number;
  exact: number;
  approximate: number;
  schemes: Record<SchemeId, { rows: number; classes: number }>;
  sample: ClassificationSampleRow[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function isRow(value: unknown): value is ClassificationSampleRow {
  if (!isObject(value) || !SCHEME_IDS.includes(value.scheme as SchemeId) || !LEVELS.includes(value.level as Level)) return false;
  if (typeof value.code !== 'string' || !/^[A-Z0-9]{1,8}$/.test(value.code)) return false;
  if (value.parent !== null && value.parent !== undefined && typeof value.parent !== 'string') return false;
  return ['label_fr', 'label_de', 'label_it', 'label_en', 'label_es'].every(key => value[key] == null || typeof value[key] === 'string');
}

/** Volumes cohérents entre eux, cinq nomenclatures présentes : sinon la fiche annonce l'indisponibilité. */
export function isClassificationsCatalogue(value: unknown): value is ClassificationsCatalogue {
  if (!isObject(value) || value.schema_version !== 2 || typeof value.version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}/.test(value.version)) return false;
  if (typeof value.checked_at !== 'string' || Number.isNaN(Date.parse(value.checked_at))) return false;
  if (!['rows', 'links', 'exact', 'approximate'].every(key => isCount(value[key]))) return false;
  if ((value.exact as number) + (value.approximate as number) !== value.links) return false;
  const schemes = value.schemes;
  if (!isObject(schemes)) return false;
  let total = 0;
  for (const id of SCHEME_IDS) {
    const scheme = schemes[id];
    if (!isObject(scheme) || !isCount(scheme.rows) || !isCount(scheme.classes) || scheme.classes > scheme.rows) return false;
    total += scheme.rows;
  }
  if (total !== value.rows) return false;
  return Array.isArray(value.sample) && value.sample.length <= 50 && value.sample.every(isRow);
}

export async function loadClassificationsCatalogue(): Promise<ClassificationsCatalogue> {
  const data = await readPublicCatalogue('classifications');
  if (!isClassificationsCatalogue(data)) throw new Error('Catalogue classifications incomplet');
  return data;
}
