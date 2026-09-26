import { sourceJson } from './crm-source.js';

type Flow = { id: number; name: string; path: string; state: string; html_url: string };
type Run = { id: number; workflow_id: number; name: string; status: string; conclusion: string | null; created_at: string; updated_at: string; event: string; head_branch: string; run_attempt: number; html_url: string };
const BASE = 'https://api.github.com/repos/cammac-creator/openswissdata/actions';
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenSwissData-dashboard' };
const cleanRun = ({ id, workflow_id, name, status, conclusion, created_at, updated_at, event, head_branch, run_attempt, html_url }: Run): Run => ({ id, workflow_id, name, status, conclusion, created_at, updated_at, event, head_branch, run_attempt, html_url });

/** Cent passages généraux, puis au plus trois recherches de tâches absentes. */
export async function readCrmWorkflows() {
  try { return await readWorkflowHistory(); }
  catch { return { available: false, checked_at: Date.now() }; }
}

async function readWorkflowHistory() {
  const [flow, general] = await Promise.all([
    sourceJson<{ workflows: Flow[] }>('github', `${BASE}/workflows?per_page=100`, { headers }),
    sourceJson<{ workflow_runs: Run[] }>('github', `${BASE}/runs?per_page=100&branch=main`, { headers }),
  ]);
  const items = flow.workflows.slice(0, 100).map(({ id, name, path, state, html_url }) => ({ id, name, path, state, html_url }));
  const ownMain = (run: Run) => run.head_branch === 'main' && !['pull_request', 'pull_request_target'].includes(run.event);
  const runs = general.workflow_runs.slice(0, 100).filter(ownMain).map(cleanRun);
  const missing = items.filter(item => !runs.some(run => run.workflow_id === item.id));
  // La surveillance passe en premier si elle n’apparaît plus dans la fenêtre générale.
  missing.sort((a, b) => Number(b.path === '.github/workflows/monitor-public.yml') - Number(a.path === '.github/workflows/monitor-public.yml') || a.id - b.id);
  const selected = missing.filter(item => item.state === 'active' && Number.isSafeInteger(item.id) && item.id > 0).slice(0, 3);
  const history = await Promise.allSettled(selected.map(item => sourceJson<{ workflow_runs: Run[] }>('github', `${BASE}/workflows/${item.id}/runs?per_page=1&branch=main`, { headers })));
  const unavailable: number[] = [];
  history.forEach((result, index) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value.workflow_runs)) {
      runs.push(...result.value.workflow_runs.slice(0, 1).filter(run => run.workflow_id === selected[index].id && ownMain(run)).map(cleanRun));
    } else unavailable.push(selected[index].id);
  });
  return { available: true, checked_at: Date.now(), items, runs, history: { general_limit: 100, supplementary_limit: 3, requested: selected.map(item => item.id), unavailable, not_requested: missing.filter(item => !selected.includes(item)).map(item => item.id) } };
}
