import { afterEach, describe, expect, it, vi } from 'vitest';
const load = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/crm-source.js', () => ({ sourceJson: load }));
import { readCrmWorkflows } from '../../src/lib/crm-workflows.js';

describe('Historique borné des automatisations', () => {
  afterEach(() => load.mockReset());
  it('retrouve une tâche moins fréquente malgré cent passages du moniteur', async () => {
    load.mockImplementation(async (_source, url) => {
      if (url.endsWith('/workflows?per_page=100')) return { workflows: [{ id: 1, name: 'Moniteur', state: 'active', path: '.github/workflows/monitor-public.yml' }, { id: 2, name: 'Collecte hebdomadaire', state: 'active', path: '.github/workflows/weekly.yml' }] };
      if (url.endsWith('/workflows/2/runs?per_page=1&branch=main')) return { workflow_runs: [{ id: 3, workflow_id: 2, head_branch: 'main', event: 'schedule', run_attempt: 1, private_extra: 'secret_fictif' }] };
      return { workflow_runs: Array.from({ length: 100 }, (_, i) => ({ id: i + 100, workflow_id: 1, head_branch: 'main', event: 'schedule', run_attempt: 1 })) };
    });
    const result = await readCrmWorkflows();
    expect(result.runs).toHaveLength(101); expect(result.runs.at(-1)?.workflow_id).toBe(2);
    expect(result.history.requested).toEqual([2]); expect(load).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain('secret_fictif');
  });
  it('borne les compléments à trois, donne priorité au moniteur absent et conserve les autres lectures en cas de panne', async () => {
    load.mockImplementation(async (_source, url) => {
      if (url.endsWith('/workflows?per_page=100')) return { workflows: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, state: 'active', path: i === 9 ? '.github/workflows/monitor-public.yml' : '.github/workflows/ancien.yml' })) };
      if (url.includes('/workflows/10/')) throw new Error('fictif');
      return { workflow_runs: [] };
    });
    const result = await readCrmWorkflows();
    expect(result.available).toBe(true); expect(result.history.requested).toEqual([10, 1, 2]);
    expect(result.history.unavailable).toEqual([10]); expect(result.history.not_requested).toHaveLength(7);
    expect(load).toHaveBeenCalledTimes(5);
  });
  it('n’associe pas un complément d’une autre tâche ou d’une autre branche', async () => {
    load.mockImplementation(async (_source, url) => url.endsWith('/workflows?per_page=100') ? { workflows: [{ id: 1, state: 'active' }] } : url.includes('/workflows/1/') ? { workflow_runs: [{ id: 8, workflow_id: 2, head_branch: 'main' }, { id: 9, workflow_id: 1, head_branch: 'autre' }] } : { workflow_runs: [] });
    expect((await readCrmWorkflows()).runs).toEqual([]);
  });
  it('réserve les compléments aux tâches actives et exclut une PR issue de main d’un fork', async () => {
    load.mockImplementation(async (_source, url) => {
      if (url.endsWith('/workflows?per_page=100')) return { workflows: [{ id: 1, state: 'disabled_inactivity' }, { id: 2, state: 'disabled_manually' }, { id: 3, state: 'active' }] };
      if (url.includes('/workflows/3/')) return { workflow_runs: [] };
      return { workflow_runs: [{ id: 4, workflow_id: 3, head_branch: 'main', event: 'pull_request' }] };
    });
    const result = await readCrmWorkflows();
    expect(result.history.requested).toEqual([3]); expect(result.runs).toEqual([]);
    expect(load.mock.calls.map(args => args[1])).toContain('https://api.github.com/repos/cammac-creator/openswissdata/actions/runs?per_page=100&branch=main');
  });
  it('retourne un échec mémorisable sans message brut lorsqu’une lecture principale échoue', async () => {
    load.mockRejectedValue(new Error('secret_fictif'));
    const result = await readCrmWorkflows();
    expect(result.available).toBe(false); expect(result.checked_at).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('secret_fictif');
  });
});
