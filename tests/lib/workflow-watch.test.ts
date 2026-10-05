import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { runWorkflowWatch, startWorkflowWatch, finmaOarFingerprint } from '../../src/lib/workflow-watch.js';

const NOW = Date.UTC(2026, 9, 5, 12, 0);
const HOUR = 3_600_000;
const WEEK = 7 * 86_400_000;
const TOKEN = '123456789:jeton-fictif-TELEGRAM-abcdefghij';
const FINMA_URL = 'https://www.finma.ch/fr/autorisation/organisme-d-autoregulation-oar/recherche-de-membres-oar/';
const SCHEDULED = ['refresh-finma.yml', 'refresh-tares.yml', 'monitor-sources.yml', 'monitor-public.yml', 'backup-db.yml', 'cleanup-expired.yml', 'indexnow.yml', 'dependency-audit.yml'];

type Github = { workflows: Record<string, string>; runs: Record<string, 'success' | 'failure' | 'other'>; status: number | null };
type Finma = { html: string; status: number | null };
type Telegram = { calls: Array<{ chat_id: string; text: string }>; status: number; ok: boolean };

const activeAll = (): Record<string, string> => Object.fromEntries(SCHEDULED.map(f => [f, 'active']));
const html = (links: string[] = ['/documents/membres-oar.xlsx']) => `<html><body>${links.map(l => `<a href="${l}">x</a>`).join('')}</body></html>`;

/** Fetch simulé : routeur par URL, aucun accès réseau réel, une Response neuve à chaque appel. */
function makeFetch(gh: Github, finma: Finma, tg: Telegram) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://api.telegram.org/')) {
      tg.calls.push(JSON.parse(String(init?.body)) as { chat_id: string; text: string });
      if (!tg.ok) return new Response(JSON.stringify({ ok: false }), { status: tg.status });
      return Response.json({ ok: true, result: { message_id: 1 } });
    }
    if (url === FINMA_URL) {
      if (finma.status !== null) return new Response('erreur', { status: finma.status });
      return new Response(finma.html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.includes('/actions/workflows?')) {
      if (gh.status !== null) return new Response('{}', { status: gh.status });
      return Response.json({ workflows: Object.entries(gh.workflows).map(([file, state]) => ({ path: `.github/workflows/${file}`, state })) });
    }
    const m = url.match(/\/actions\/workflows\/([^/]+)\/runs\?/);
    if (m) {
      if (gh.status !== null) return new Response('{}', { status: gh.status });
      const conclusion = gh.runs[m[1] ?? ''];
      return Response.json({ workflow_runs: conclusion ? [{ conclusion }] : [] });
    }
    throw new Error(`url inattendue dans le test : ${url}`);
  });
}

const witness = () => getDb().prepare("SELECT checked_at,details_json FROM operation_checks WHERE name='workflow_watch'").get() as { checked_at: number; details_json: string } | undefined;
const run = (gh: Github, finma: Finma, tg: Telegram, now: number) => runWorkflowWatch({ fetch: makeFetch(gh, finma, tg), now: () => now });

describe('Veille des tâches planifiées et de la page FINMA des membres OAR', () => {
  let temp: string;
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'osd-veille-taches-'));
    process.env.DATABASE_PATH = join(temp, 'fictive.sqlite');
    process.env.OSD_VEILLE_TELEGRAM_TOKEN = TOKEN;
    process.env.OSD_VEILLE_TELEGRAM_CHAT = '424242';
  });
  afterEach(() => {
    closeDb(); rmSync(temp, { recursive: true, force: true });
    for (const name of ['DATABASE_PATH', 'OSD_VEILLE_TELEGRAM_TOKEN', 'OSD_VEILLE_TELEGRAM_CHAT', 'OSD_GITHUB_REPO']) delete process.env[name];
    vi.useRealTimers(); vi.restoreAllMocks();
  });

  it('signale une tâche qui passe à disabled_inactivity une seule fois, puis se tait tant que rien ne change', async () => {
    const gh: Github = { workflows: activeAll(), runs: {}, status: null };
    const finma: Finma = { html: html(), status: null };
    const tg: Telegram = { calls: [], status: 200, ok: true };
    await run(gh, finma, tg, NOW); // passage de référence
    expect(tg.calls).toHaveLength(0);

    gh.workflows = { ...gh.workflows, 'indexnow.yml': 'disabled_inactivity' };
    const second = await run(gh, finma, tg, NOW + HOUR);
    expect(tg.calls).toHaveLength(1);
    expect(tg.calls[0]!.text).toContain("Tâche indexnow.yml : état « disabled_inactivity »");
    expect(second).toMatchObject({ status: 'ok', total_alerted: 1 });

    const third = await run(gh, finma, tg, NOW + 2 * HOUR);
    expect(tg.calls).toHaveLength(1); // aucun nouveau message : l'état n'a pas changé
    expect(third).toMatchObject({ status: 'ok', total_alerted: 1 });
  });

  it('signale le canari qui échoue, puis son retour à la normale', async () => {
    const gh: Github = { workflows: activeAll(), runs: { 'monitor-sources.yml': 'success' }, status: null };
    const finma: Finma = { html: html(), status: null };
    const tg: Telegram = { calls: [], status: 200, ok: true };
    await run(gh, finma, tg, NOW);

    gh.runs = { 'monitor-sources.yml': 'failure' };
    await run(gh, finma, tg, NOW + HOUR);
    expect(tg.calls).toHaveLength(1);
    expect(tg.calls[0]!.text).toContain('Canari des 20 sources : dernier passage en échec.');

    gh.runs = { 'monitor-sources.yml': 'success' };
    await run(gh, finma, tg, NOW + 2 * HOUR);
    expect(tg.calls).toHaveLength(2);
    expect(tg.calls[1]!.text).toContain('Canari des 20 sources : retour à la normale.');
  });

  it("GitHub en 403 : passe « non vérifiable » sans message avant 24 h, un seul après", async () => {
    const finma: Finma = { html: html(), status: null };
    const tg: Telegram = { calls: [], status: 200, ok: true };
    const gh: Github = { workflows: activeAll(), runs: {}, status: 403 };
    const offsets = [0, 6 * HOUR, 18 * HOUR, 24 * HOUR, 30 * HOUR];
    const expectedMessages = [0, 0, 0, 1, 0];
    for (let i = 0; i < offsets.length; i++) {
      const result = await run(gh, finma, tg, NOW + offsets[i]!);
      expect(result.status).toBe('unverifiable');
      expect(tg.calls).toHaveLength(expectedMessages.slice(0, i + 1).reduce((a, b) => a + b, 0));
    }
  });

  it('garde l’état précédent quand Telegram refuse, et renvoie le même message au passage suivant', async () => {
    const gh: Github = { workflows: activeAll(), runs: {}, status: null };
    const finma: Finma = { html: html(), status: null };
    const tg: Telegram = { calls: [], status: 200, ok: true };
    await run(gh, finma, tg, NOW); // référence : tout actif

    gh.workflows = { ...gh.workflows, 'cleanup-expired.yml': 'disabled_manually' };
    tg.ok = false; tg.status = 502;
    const failed = await run(gh, finma, tg, NOW + HOUR);
    expect(failed).toMatchObject({ status: 'error', code: 'telegram_http', http_status: 502 });
    expect(tg.calls).toHaveLength(1);
    const kept = JSON.parse(witness()!.details_json) as { workflows: Record<string, string> };
    expect(kept.workflows['cleanup-expired.yml']).toBe('active'); // pas encore adopté

    tg.ok = true;
    const retried = await run(gh, finma, tg, NOW + 2 * HOUR);
    expect(tg.calls).toHaveLength(2);
    expect(tg.calls[1]!.text).toContain("Tâche cleanup-expired.yml : état « disabled_manually »");
    expect(retried).toMatchObject({ status: 'ok' });
    const adopted = JSON.parse(witness()!.details_json) as { workflows: Record<string, string> };
    expect(adopted.workflows['cleanup-expired.yml']).toBe('disabled_manually');

    const silent = await run(gh, finma, tg, NOW + 3 * HOUR);
    expect(tg.calls).toHaveLength(2);
    expect(silent).toMatchObject({ status: 'ok' });
  });

  it('relit la page FINMA des membres OAR une fois par semaine ; un fichier de plus déclenche un message', async () => {
    const gh: Github = { workflows: activeAll(), runs: {}, status: null };
    const finma: Finma = { html: html(['/documents/membres-oar.xlsx']), status: null };
    const tg: Telegram = { calls: [], status: 200, ok: true };
    await run(gh, finma, tg, NOW); // fixe l'empreinte initiale

    await run(gh, finma, tg, NOW + 6 * HOUR); // trop tôt, pas relu
    expect(tg.calls).toHaveLength(0);

    finma.html = html(['/documents/membres-oar.xlsx', '/documents/annexe.xlsx']);
    const changed = await run(gh, finma, tg, NOW + WEEK + HOUR);
    expect(tg.calls).toHaveLength(1);
    expect(tg.calls[0]!.text).toContain("page FINMA de recherche des membres OAR a changé");
    expect(changed).toMatchObject({ status: 'ok' });
  });

  it('calcule la même empreinte FINMA pour des liens réordonnés ou avec une autre query, et une empreinte différente avec un fichier de plus', () => {
    const a = finmaOarFingerprint(html(['/d/a.xlsx?v=1', '/d/b.xlsx']));
    const b = finmaOarFingerprint(html(['/d/b.xlsx', '/d/a.xlsx?v=2']));
    expect(a).toBe(b);
    const c = finmaOarFingerprint(html(['/d/a.xlsx', '/d/b.xlsx', '/d/c.xlsx']));
    expect(c).not.toBe(a);
  });

  it("n'écrit aucune adresse ni jeton dans le témoin ou les journaux, même si Telegram échoue par une erreur réseau", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW);
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => {}));
    const gh: Github = { workflows: { ...activeAll(), 'indexnow.yml': 'disabled_manually' }, runs: {}, status: null };
    const finma: Finma = { html: html(), status: null };
    const leaking = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://api.telegram.org/')) throw new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed`);
      if (url === FINMA_URL) return new Response(html(), { status: 200 });
      if (url.includes('/actions/workflows?')) return Response.json({ workflows: Object.entries(gh.workflows).map(([file, state]) => ({ path: `.github/workflows/${file}`, state })) });
      return Response.json({ workflow_runs: [] });
    });
    const results: unknown[] = [];
    const stop = startWorkflowWatch({ run: async () => { const r = await runWorkflowWatch({ fetch: leaking }); results.push(r); return r; } });
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.waitFor(() => expect(results).toHaveLength(1));
    stop();
    // Premier passage après START_DELAY (120 s) : l'horloge simulée doit être vue à l'exécution, pas au chargement du module.
    expect(results).toEqual([expect.objectContaining({ status: 'error', code: 'telegram_network', checked_at: NOW + 120_000 })]);
    const everything = JSON.stringify([results, witness(), logs.map(l => l.mock.calls)]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('jeton-fictif');
    expect(everything).not.toContain('@');
  });
});
