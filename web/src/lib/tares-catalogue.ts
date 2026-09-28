import { readPublicCatalogue } from './public-catalogue';

/** Ligne du résumé TARES telle que publiée dans l'échantillon du catalogue (schéma 2). */
export interface TaresSampleRow {
  hs8: string;
  designation_fr: string;
  designation_de: string;
  designation_en: string;
  unit_stat: string;
  duty_mfn_value?: number;
  duty_mfn_unit?: string;
  preferential_regimes: Record<string, number | 'free'>;
  duty_rates_count: number;
  valid_from: string;
  source_url: string;
}
export interface TaresCatalogue {
  version: string;
  checked_at: string;
  rows: number;
  rates: number;
  missing_mfn_summary: number;
  previous_version: string;
  added: number;
  removed: number;
  changed_fields: number;
  sample: TaresSampleRow[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isText = (value: unknown): value is string => typeof value === 'string';

function isRow(value: unknown): value is TaresSampleRow {
  if (!isObject(value) || !isText(value.hs8) || !/^\d{8}$/.test(value.hs8)) return false;
  if (!['designation_fr', 'designation_de', 'valid_from', 'source_url'].every(key => isText(value[key]))) return false;
  if (value.designation_en != null && !isText(value.designation_en)) return false;
  if (value.unit_stat != null && !isText(value.unit_stat)) return false;
  if (!isCount(value.duty_rates_count)) return false;
  // Un résumé n'existe qu'avec une valeur finie, positive ou nulle, et son unité.
  if (value.duty_mfn_value != null && (typeof value.duty_mfn_value !== 'number' || !Number.isFinite(value.duty_mfn_value) || value.duty_mfn_value < 0 || !isText(value.duty_mfn_unit))) return false;
  const regimes = value.preferential_regimes;
  return isObject(regimes) && Object.values(regimes).every(rate => rate === 'free' || (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0));
}

/** Refuse toute réponse incohérente : aucun zéro de secours, aucune ligne douteuse affichée. */
export function isTaresCatalogue(value: unknown): value is TaresCatalogue {
  if (!isObject(value) || value.schema_version !== 2 || !isText(value.version) || !/^\d{4}\.\d{2}\.\d{2}/.test(value.version)) return false;
  if (!isText(value.checked_at) || Number.isNaN(Date.parse(value.checked_at)) || !isText(value.previous_version)) return false;
  if (!['rows', 'rates', 'missing_mfn_summary', 'added', 'removed', 'changed_fields'].every(key => isCount(value[key]))) return false;
  if ((value.missing_mfn_summary as number) > (value.rows as number) || (value.rates as number) < (value.rows as number)) return false;
  return Array.isArray(value.sample) && value.sample.length > 0 && value.sample.length <= 100 && value.sample.every(isRow);
}

let pending: Promise<TaresCatalogue> | undefined;
/** Une seule lecture par page, partagée par la fiche et son explorateur. */
export function loadTaresCatalogue(): Promise<TaresCatalogue> {
  pending ??= readPublicCatalogue('tares').then(data => {
    if (!isTaresCatalogue(data)) throw new Error('Catalogue TARES incomplet');
    return data;
  });
  return pending;
}

/** Numéro suisse en notation Tares : 85011000 → 8501.1000. */
export const dottedTariff = (hs8: string): string => `${hs8.slice(0, 4)}.${hs8.slice(4)}`;

/** Seuls les liens vers la source officielle sont repris depuis la réponse. */
export function officialSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'xtares.admin.ch' ? url.href : null;
  } catch {
    return null;
  }
}
