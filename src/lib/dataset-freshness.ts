import { isCalendarDate } from './calendar-date.js';

/** Âge de l’édition datée, depuis minuit UTC ; pas l’heure réelle de collecte. */
export function finmaFreshness(version: unknown, now = Date.now()) {
  const validVersion = typeof version === 'string' && /^\d{4}\.\d{2}\.\d{2}$/.test(version) && isCalendarDate(version.replaceAll('.', '-'));
  const age = validVersion ? (now - Date.parse(version.replaceAll('.', '-') + 'T00:00:00Z')) / 3_600_000 : NaN;
  const validAge = Number.isFinite(age) && age >= 0;
  return {
    status: validAge && age < 72 ? 'ok' as const : 'stale' as const,
    finma_version: validVersion ? version : null,
    age_hours: validAge ? Math.round(age) : null,
  };
}
