/** Jours calendaires suisses, y compris les journées de 23 ou 25 heures. */
export type CrmPeriod = { timezone: 'Europe/Zurich'; start: string; end: string; start_at: number; end_at: number; days: string[] };
const zone = 'Europe/Zurich';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function parts(at: number): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(at).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
export function swissDay(at: number): string {
  const p = parts(at); return `${p.year}-${p.month}-${p.day}`;
}
export function calendarDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}
export function swissMidnight(day: string): number {
  const target = Date.parse(`${day}T00:00:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(guess);
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const delta = target - local;
    if (!delta) return guess;
    guess += delta;
  }
  throw new Error('crm_calendar_unavailable');
}
export function crmPeriod(count: number, now = Date.now()): CrmPeriod {
  if (![7, 30, 90, 365].includes(count) || !Number.isSafeInteger(now)) throw new Error('crm_period_invalid');
  const end = swissDay(now), days = Array.from({ length: count }, (_, i) => calendarDay(end, i - count + 1));
  // Borne exclusive : inclure la milliseconde du relevé, exclure les écritures futures.
  return { timezone: zone, start: days[0], end, start_at: swissMidnight(days[0]), end_at: now + 1, days };
}
export function periodRanges(period: CrmPeriod): Array<{ day: string; start: number; end: number }> {
  const starts = period.days.map(swissMidnight);
  return period.days.map((day, i) => ({ day, start: starts[i], end: starts[i + 1] ?? period.end_at }));
}
