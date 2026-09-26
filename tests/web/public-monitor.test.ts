import { describe, expect, it } from 'vitest';
import { publicMonitorStatus, renderPublicMonitor } from '../../web/src/lib/public-monitor';
const now = Date.parse('2026-09-26T12:30:00Z');
const run = { id: 2, workflow_id: 1, head_branch: 'main', event: 'schedule', run_attempt: 1, status: 'completed', conclusion: 'success', created_at: '2026-09-26T12:23:00Z', updated_at: '2026-09-26T12:24:00Z' };
const source = () => ({ available: true, checked_at: now - 60_000, items: [{ id: 1, path: '.github/workflows/monitor-public.yml', state: 'active' }], runs: [{ ...run }] });
describe('État du moniteur dans le CRM', () => {
  it('présente le passage horaire récent, ses limites et un lien fixe', () => {
    expect(publicMonitorStatus(source(), now).healthy).toBe(true);
    const html = renderPublicMonitor(source(), now);
    expect(html).toContain('Passage automatique récent'); expect(html).toContain('2 h 30'); expect(html).toContain('60 jours'); expect(html).toContain('réception d’une notification n’est pas vérifiée');
  });
  it.each(['disabled_inactivity', 'disabled_manually', 'deleted'])('ne transforme pas un ancien succès en surveillance active : %s', state => {
    const s = source(); s.items[0].state = state; expect(publicMonitorStatus(s, now).label).toBe('Surveillance suspendue');
  });
  it('distingue passage manuel, observation automatique et ancienneté', () => {
    const s = source(); s.runs[0].event = 'workflow_dispatch';
    expect(publicMonitorStatus(s, now).label).toBe('Premier passage automatique attendu');
    s.runs.push({ ...run, id: 1, created_at: '2026-09-26T09:23:00Z', updated_at: '2026-09-26T09:24:00Z' });
    expect(publicMonitorStatus(s, now).label).toBe('Passage automatique ancien');
  });
  it('n’efface pas un échec horaire par un succès manuel', () => {
    const s = source(); s.runs[0].event = 'workflow_dispatch';
    s.runs.push({ ...run, id: 1, conclusion: 'failure', created_at: '2026-09-26T11:23:00Z' });
    expect(publicMonitorStatus(s, now).label).toBe('Passage automatique à vérifier');
  });
  it('ne présente pas une relance manuelle d’un schedule comme passage automatique réussi', () => {
    for (const run_attempt of [0, 2, undefined]) {
      const s = source(); s.runs[0].run_attempt = run_attempt as number;
      expect(publicMonitorStatus(s, now).label).toBe('Passage horaire relancé ou à confirmer');
    }
  });
  it.each(['queued', 'in_progress'])('distingue un contrôle %s d’un échec', status => {
    const s = source(); s.runs[0].status = status;
    expect(publicMonitorStatus(s, now).label).toBe('Contrôle en attente');
  });
  it.each(['failure', 'cancelled', 'timed_out', 'skipped'])('ne masque pas le dernier résultat %s', conclusion => {
    const s = source(); s.runs[0].conclusion = conclusion; expect(publicMonitorStatus(s, now).label).toBe('Dernier contrôle à vérifier');
  });
  it('trie les passages et ignore les autres branches', () => {
    const s = source(); s.runs.unshift({ ...run, id: 1, conclusion: 'failure', created_at: '2026-09-26T11:23:00Z' });
    s.runs.push({ ...run, id: 3, conclusion: 'failure', head_branch: 'autre' });
    expect(publicMonitorStatus(s, now).healthy).toBe(true);
    s.runs = s.runs.filter(r => r.head_branch === 'autre'); expect(publicMonitorStatus(s, now).label).toBe('Premier contrôle attendu');
  });
  it('refuse les dates invalides, futures et la lecture GitHub ancienne', () => {
    for (const created_at of ['invalide', '2026-09-27T00:00:00Z']) {
      const s = source(); s.runs[0].created_at = created_at; expect(publicMonitorStatus(s, now).label).toBe('Date à vérifier');
    }
    for (const updated_at of ['invalide', '2026-09-27T00:00:00Z', '2026-09-26T11:00:00Z']) {
      const s = source(); s.runs[0].updated_at = updated_at; expect(publicMonitorStatus(s, now).label).toBe('Fin de contrôle à vérifier');
    }
    const s = source(); s.checked_at = now - 1_200_001; expect(publicMonitorStatus(s, now).label).toBe('Lecture à renouveler');
    expect(publicMonitorStatus({ available: false }, now).healthy).toBe(false);
  });
  it('attend le résultat, distingue absence de tâche et n’injecte pas de contenu tiers', () => {
    const s = source(); s.runs[0].status = 'in_progress'; expect(publicMonitorStatus(s, now).label).toBe('Contrôle en attente');
    s.items = []; expect(publicMonitorStatus(s, now).label).toBe('Installation non confirmée');
    s.runs[0].created_at = '<img src=x onerror=alert(1)>'; expect(renderPublicMonitor(s, now)).not.toContain('<img');
  });
  it('distingue histoire indisponible, non consultée et absence de passage', () => {
    const s = source(); s.runs = [];
    expect(publicMonitorStatus({ ...s, history: { unavailable: [1] } }, now).label).toBe('Historique indisponible');
    expect(publicMonitorStatus({ ...s, history: { not_requested: [1] } }, now).label).toBe('Historique non consulté');
    expect(publicMonitorStatus(s, now).label).toBe('Premier contrôle attendu');
  });
});
