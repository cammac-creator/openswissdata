import { describe, expect, it, vi } from 'vitest';
import { buildAlertEmail, decideAlert, describeMonitorReport, runAlert } from '../../scripts/alert-email.mjs';

const env = (over: Record<string, string> = {}) => ({
  GITHUB_REPOSITORY: 'cammac-creator/openswissdata', GITHUB_RUN_ID: '42', GITHUB_TOKEN: 'jeton-fictif',
  ALERT_WORKFLOW: 'monitor-public.yml', ALERT_TASK: 'Surveillance publique', ALERT_CURRENT: 'failure',
  RESEND_API_KEY: 're_fictif', RESEND_FROM_EMAIL: 'OpenSwissData <alerte@example.test>', ALERT_EMAIL: 'destinataire@example.test', ...over,
});
const github = (conclusion: string | null) => Response.json({ workflow_runs: [{ id: 42, conclusion: null }, ...(conclusion ? [{ id: 41, conclusion }] : [])] });
const fetcher = (previous: string | null, resend: () => Response = () => Response.json({ id: 'courriel-1' })) => vi.fn(async (url: string) =>
  url.startsWith('https://api.github.com/') ? github(previous) : resend());

describe('Alerte par mail sur changement d’état', () => {
  it('ne prévient qu’à la première panne et au retour à la normale', () => {
    expect(decideAlert('failure', 'success')).toBe('panne');
    expect(decideAlert('failure', null)).toBe('panne');
    expect(decideAlert('failure', 'failure')).toBeNull();
    expect(decideAlert('success', 'failure')).toBe('retabli');
    expect(decideAlert('success', 'success')).toBeNull();
    expect(decideAlert('cancelled', 'success')).toBeNull();
  });

  it('rédige un message court, daté en heure suisse, sans donnée brute', () => {
    const lines = describeMonitorReport({ checks: [{ name: 'ready', ok: false, http: 503, reason: 'http_error' }, { name: 'freshness', ok: true, http: 200, reason: 'verified', version: '2026.09.28' }] });
    expect(lines).toEqual(['ready : à vérifier · HTTP 503 · http_error', 'freshness : vérifié · HTTP 200 · verified · édition 2026.09.28']);
    const mail = buildAlertEmail({ kind: 'panne', task: 'Surveillance publique', lines, runUrl: 'https://github.com/x/y/actions/runs/1', when: new Date('2026-09-28T18:18:24Z'), simulated: true });
    expect(mail.subject).toBe('OpenSwissData · Surveillance publique : problème détecté [simulation]');
    expect(mail.text).toContain('28.09.2026 20:18'); expect(mail.text).toContain('- ready : à vérifier · HTTP 503 · http_error');
    expect(mail.text).toContain('Simulation demandée');
    expect(buildAlertEmail({ kind: 'retabli', task: 'Sauvegarde', runUrl: 'u', when: new Date('2026-09-28T18:19:16Z') }).subject).toBe('OpenSwissData · Sauvegarde : retour à la normale');
  });

  it('envoie la panne au prestataire existant avec l’adresse configurée', async () => {
    const fetchImpl = fetcher('success');
    const result = await runAlert(env(), { fetchImpl, now: () => new Date('2026-09-28T18:18:24Z') });
    expect(result).toMatchObject({ sent: true, reason: 'accepted', kind: 'panne', previous: 'success', id: 'courriel-1' });
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ['destinataire@example.test'], from: 'OpenSwissData <alerte@example.test>' });
    expect(JSON.stringify(result)).not.toMatch(/destinataire|re_fictif|jeton-fictif/);
  });

  it('se tait pendant une panne qui dure et sans configuration complète', async () => {
    const same = fetcher('failure');
    expect(await runAlert(env(), { fetchImpl: same })).toMatchObject({ sent: false, reason: 'unchanged' });
    expect(same).toHaveBeenCalledTimes(1);
    const unset = fetcher('success');
    expect(await runAlert(env({ ALERT_EMAIL: '' }), { fetchImpl: unset })).toMatchObject({ sent: false, reason: 'not_configured', kind: 'panne' });
    expect(unset).toHaveBeenCalledTimes(1);
  });

  it('préfère un doublon de panne à un silence, jamais un faux retour à la normale', async () => {
    const broken = vi.fn(async (url: string) => url.startsWith('https://api.github.com/') ? new Response('', { status: 500 }) : Response.json({ id: 'courriel-2' }));
    expect(await runAlert(env(), { fetchImpl: broken })).toMatchObject({ sent: true, kind: 'panne', lookup: 'unavailable' });
    const quiet = vi.fn(async (url: string) => url.startsWith('https://api.github.com/') ? new Response('', { status: 500 }) : Response.json({ id: 'x' }));
    expect(await runAlert(env({ ALERT_CURRENT: 'success' }), { fetchImpl: quiet })).toMatchObject({ sent: false, reason: 'unchanged' });
    expect(quiet).toHaveBeenCalledTimes(1);
  });

  it('signale un refus du prestataire sans en recopier la réponse', async () => {
    const refused = fetcher('success', () => Response.json({ message: 'détail du prestataire' }, { status: 422 }));
    const result = await runAlert(env(), { fetchImpl: refused });
    expect(result).toMatchObject({ sent: false, reason: 'provider_refused', http: 422 });
    expect(JSON.stringify(result)).not.toContain('détail du prestataire');
  });
});

describe('Remise d’une alerte simulée', () => {
  it('relit l’état de remise chez le prestataire, sans l’adresse', async () => {
    const fetchImpl = vi.fn(async (url: string) => url.startsWith('https://api.github.com/') ? Response.json({ workflow_runs: [{ id: 41, conclusion: 'success' }] })
      : url.endsWith('/emails') ? Response.json({ id: 'courriel-3' }) : Response.json({ id: 'courriel-3', to: ['destinataire@example.test'], last_event: 'delivered' }));
    const result = await runAlert(env({ ALERT_SIMULATED: 'true' }), { fetchImpl, wait: async () => {} });
    expect(result).toMatchObject({ sent: true, kind: 'panne', delivery: 'delivered' });
    expect(fetchImpl.mock.calls[2][0]).toBe('https://api.resend.com/emails/courriel-3');
    expect(JSON.stringify(result)).not.toContain('destinataire');
  });
  it('ne décrit pas un retour à la normale avec le texte de la panne', async () => {
    const fetchImpl = fetcher('failure');
    await runAlert(env({ ALERT_CURRENT: 'success', ALERT_DETAIL: 'La collecte a échoué.' }), { fetchImpl });
    const body = JSON.parse(String((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body));
    expect(body.subject).toContain('retour à la normale'); expect(body.text).not.toContain('La collecte a échoué.');
  });
});
