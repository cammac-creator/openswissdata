import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeepHealthChecker } from '../../src/lib/deep-health.js';
import { renderDependencyResult } from '../../web/src/lib/service-health.js';

describe('Diagnostic borné des dépendances', () => {
  afterEach(() => vi.useRealTimers());
  it('mutualise dix demandes simultanées et ne relance qu’après une minute', async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => {});
    const diagnose = createDeepHealthChecker({ db: probe, r2: probe, stripe: probe }, () => Date.now());
    const results = await Promise.all(Array.from({ length: 10 }, () => diagnose()));
    expect(probe).toHaveBeenCalledTimes(3);
    expect(results.every(r => r === results[0])).toBe(true);
    expect(results[0].status).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(await diagnose()).toBe(results[0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await diagnose()).not.toBe(results[0]);
    expect(probe).toHaveBeenCalledTimes(6);
  });
  it('conserve aussi les échecs et ne divulgue pas le message du fournisseur', async () => {
    const fail = vi.fn(async () => { throw new Error('secret fictif, compte et chemin privé'); });
    const diagnose = createDeepHealthChecker({ db: async () => {}, r2: fail, stripe: fail });
    const result = await diagnose();
    expect(result.status).toBe('degraded');
    expect(result.checks.r2).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(await diagnose()).toBe(result);
    expect(fail).toHaveBeenCalledTimes(2);
  });
  it('libère la réponse après trois secondes et annule une sonde bloquée', async () => {
    vi.useFakeTimers();
    let received: AbortSignal | undefined;
    const diagnose = createDeepHealthChecker({
      db: async () => {}, stripe: async () => {},
      r2: signal => { received = signal; return new Promise<void>(() => {}); },
    }, () => Date.now());
    const pending = diagnose();
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await pending;
    expect(received?.aborted).toBe(true);
    expect(result.checks.r2).toEqual({ ok: false, ms: 3_000, reason: 'timeout' });
    expect(result.checks.db.ok).toBe(true);
    expect(result.status).toBe('degraded');
    expect(vi.getTimerCount()).toBe(0);
    expect(await diagnose()).toBe(result);
  });
  it('convertit aussi une exception synchrone en échec limité', async () => {
    const diagnose = createDeepHealthChecker({ db: () => { throw new Error('sqlite privé'); }, r2: async () => {}, stripe: async () => {} });
    expect((await diagnose()).checks.db).toMatchObject({ ok: false, reason: 'unavailable' });
  });
  it('distingue un délai du SDK Stripe d’une autre erreur réseau', async () => {
    for (const [code, reason] of [['ETIMEDOUT', 'timeout'], ['ECONNRESET', 'unavailable']]) {
      const diagnose = createDeepHealthChecker({ db: async () => {}, r2: async () => {}, stripe: async () => {
        throw { type: 'StripeConnectionError', detail: { code }, message: 'Information privée fictive' };
      } });
      expect((await diagnose()).checks.stripe).toMatchObject({ ok: false, reason });
    }
  });
  it('refait le contrôle si l’horloge est revenue avant le résultat conservé', async () => {
    let now = 10_000;
    const probe = vi.fn(async () => {});
    const diagnose = createDeepHealthChecker({ db: probe, r2: probe, stripe: probe }, () => now);
    await diagnose(); now = 9_000; await diagnose();
    expect(probe).toHaveBeenCalledTimes(6);
  });
  it('affiche les limites et ignore tout texte fournisseur imprévu', () => {
    const value = { status: 'degraded', checked_at: Date.UTC(2026, 8, 26, 7), checks: {
      db: { ok: true }, r2: { ok: false, reason: '<img src=x onerror=alert(1)>' }, stripe: { ok: false, reason: 'timeout' },
    } };
    const html = renderDependencyResult(value);
    expect(html).toContain('Base de données');
    expect(html).toContain('Délai de réponse dépassé');
    expect(html).toContain('heure suisse');
    expect(html).not.toContain('<img');
    value.checks.r2.reason = 'constructor';
    expect(renderDependencyResult(value)).not.toContain('function Object');
    expect(() => renderDependencyResult({ status: 'ok' })).toThrow();
  });
});
