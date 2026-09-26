import { describe, expect, it } from 'vitest';
import { calendarDay, crmPeriod, periodRanges, swissDay, swissMidnight } from '../../src/lib/crm-period.js';

describe('Périodes calendaires du bureau', () => {
  it('inclut le jour suisse qui commence avant minuit UTC', () => {
    const p = crmPeriod(7, Date.parse('2026-09-25T22:10:00Z'));
    expect(p.start).toBe('2026-09-20'); expect(p.end).toBe('2026-09-26');
    expect(p.start_at).toBe(Date.parse('2026-09-19T22:00:00Z'));
    expect(p.days).toHaveLength(7); expect(p.end_at).toBe(Date.parse('2026-09-25T22:10:00Z') + 1);
  });
  it.each([
    ['2026-03-29', 23, '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z'],
    ['2026-10-25', 25, '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z'],
    ['2026-09-26', 24, '2026-09-25T22:00:00Z', '2026-09-26T22:00:00Z'],
  ])('borne le %s sans supposer vingt-quatre heures', (day, hours, from, until) => {
    const start = swissMidnight(day), end = swissMidnight(calendarDay(day, 1));
    expect(start).toBe(Date.parse(from)); expect(end).toBe(Date.parse(until));
    expect((end - start) / 3_600_000).toBe(hours);
    expect(swissDay(start - 1)).toBe(calendarDay(day, -1)); expect(swissDay(start)).toBe(day);
  });
  it('ne crée ni trou ni doublon sur une année avec deux changements d’heure', () => {
    const now = Date.parse('2026-12-31T12:00:00Z'), ranges = periodRanges(crmPeriod(365, now));
    expect(ranges).toHaveLength(365); expect(new Set(ranges.map(r => r.day)).size).toBe(365);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].start).toBe(ranges[i - 1].end);
    expect(ranges.at(-1)!.end).toBe(now + 1);
    expect(ranges.filter(r => r.end - r.start === 23 * 3_600_000)).toHaveLength(1);
    expect(ranges.filter(r => r.end - r.start === 25 * 3_600_000)).toHaveLength(1);
  });
  it('traverse février bissextile et le nouvel an', () => {
    expect(calendarDay('2024-03-01', -1)).toBe('2024-02-29');
    expect(calendarDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(crmPeriod(7, Date.parse('2026-01-01T12:00:00Z')).start).toBe('2025-12-26');
  });
});
