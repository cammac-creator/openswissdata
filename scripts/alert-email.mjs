import { readFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Alerte par mail sur changement d'état d'une tâche GitHub : un message à la
// première panne, un message au rétablissement, rien entre les deux.
// Envoi par le prestataire existant du projet (Resend). Aucun secret, aucune
// adresse ni réponse brute du prestataire n'est écrit dans le journal public.
const UA = 'OpenSwissData-alerte/1';

export function decideAlert(current, previous) {
  if (current === 'failure' && previous !== 'failure') return 'panne';
  if (current === 'success' && previous === 'failure') return 'retabli';
  return null;
}

const swissTime = date => new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);

export function describeMonitorReport(report) {
  if (!report || !Array.isArray(report.checks)) return [];
  return report.checks.map(c => `${c.name} : ${c.ok ? 'vérifié' : 'à vérifier'} · HTTP ${c.http ?? 'absent'} · ${c.reason}${c.revision ? ' · révision ' + String(c.revision).slice(0, 7) : ''}${c.version ? ' · édition ' + c.version : ''}`);
}

export function buildAlertEmail({ kind, task, lines = [], runUrl, when = new Date(), simulated = false }) {
  const at = swissTime(when);
  const subject = kind === 'panne'
    ? `OpenSwissData · ${task} : problème détecté${simulated ? ' [simulation]' : ''}`
    : `OpenSwissData · ${task} : retour à la normale`;
  const intro = kind === 'panne'
    ? `La tâche « ${task} » d'OpenSwissData a échoué le ${at} (heure suisse).`
    : `La tâche « ${task} » d'OpenSwissData a de nouveau réussi le ${at} (heure suisse).`;
  const outro = kind === 'panne'
    ? 'Ce message part une seule fois par panne ; un second message annoncera le retour à la normale.'
    : 'Aucune action n’est nécessaire si ce retour est attendu.';
  const text = [intro, '', ...lines.map(l => `- ${l}`), ...(lines.length ? [''] : []),
    `Détail : ${runUrl}`, '', outro,
    ...(simulated ? ['', 'Simulation demandée : le service réel n’a pas été lu.'] : [])].join('\n');
  return { subject, text };
}

export async function previousConclusion({ repo, workflow, runId, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=main&status=completed&per_page=10`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`github_${res.status}`);
  const body = await res.json();
  const run = (body.workflow_runs ?? []).find(r => String(r.id) !== String(runId));
  return run ? run.conclusion : null;
}

export async function sendAlert({ apiKey, from, to, subject, text, fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  let id = null;
  try { const body = await res.json(); id = typeof body?.id === 'string' ? body.id : null; } catch { /* corps illisible : identifiant absent */ }
  return { status: res.status, id };
}

// Lors d'une simulation seulement : relire l'état de remise chez le prestataire (livré, rebond…).
export async function deliveryEvent({ apiKey, id, fetchImpl = fetch, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  await wait(8_000);
  try {
    const res = await fetchImpl(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${apiKey}`, 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return `non consultable (HTTP ${res.status})`;
    const body = await res.json();
    return typeof body?.last_event === 'string' ? body.last_event : 'inconnu';
  } catch { return 'non consultable'; }
}

export async function runAlert(env, { fetchImpl = fetch, now = () => new Date(), wait } = {}) {
  const task = env.ALERT_TASK || 'Surveillance';
  const current = env.ALERT_CURRENT;
  let previous = null, lookup = 'ok';
  try {
    previous = await previousConclusion({ repo: env.GITHUB_REPOSITORY, workflow: env.ALERT_WORKFLOW, runId: env.GITHUB_RUN_ID, token: env.GITHUB_TOKEN, fetchImpl });
  } catch { lookup = 'unavailable'; }
  // Sans historique lisible, mieux vaut un doublon de panne qu'un silence ; jamais un faux rétablissement.
  const kind = lookup === 'ok' ? decideAlert(current, previous) : (current === 'failure' ? 'panne' : null);
  if (!kind) return { sent: false, reason: 'unchanged', previous, lookup };
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !env.ALERT_EMAIL) return { sent: false, reason: 'not_configured', kind, previous, lookup };
  let lines = [];
  if (env.ALERT_REPORT_FILE) {
    try { lines = describeMonitorReport(JSON.parse(readFileSync(env.ALERT_REPORT_FILE, 'utf8'))); } catch { lines = []; }
  }
  if (!lines.length && env.ALERT_DETAIL && kind === 'panne') lines = [env.ALERT_DETAIL];
  const runUrl = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const mail = buildAlertEmail({ kind, task, lines, runUrl, when: now(), simulated: env.ALERT_SIMULATED === 'true' });
  try {
    const result = await sendAlert({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, to: env.ALERT_EMAIL, ...mail, fetchImpl });
    const sent = result.status >= 200 && result.status < 300 && !!result.id;
    const delivery = sent && env.ALERT_SIMULATED === 'true' ? await deliveryEvent({ apiKey: env.RESEND_API_KEY, id: result.id, fetchImpl, ...(wait ? { wait } : {}) }) : undefined;
    return { sent, reason: sent ? 'accepted' : 'provider_refused', kind, previous, lookup, http: result.status, id: result.id, ...(delivery ? { delivery } : {}) };
  } catch { return { sent: false, reason: 'provider_unreachable', kind, previous, lookup }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runAlert(process.env);
  console.log(JSON.stringify(result));
  const label = { unchanged: 'aucune alerte : état inchangé', not_configured: 'alerte non envoyée : adresse ou prestataire non configuré', accepted: `alerte « ${result.kind} » acceptée par le prestataire (identifiant ${result.id}${result.delivery ? ', remise : ' + result.delivery : ''})`, provider_refused: `alerte refusée par le prestataire (HTTP ${result.http})`, provider_unreachable: 'prestataire injoignable' }[result.reason];
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Alerte par mail\n${label}. Précédent résultat : ${result.previous ?? 'inconnu'}.\n`);
  // Seul un envoi nécessaire et manqué fait échouer cette étape ; l'absence de configuration reste visible sans masquer la tâche.
  process.exitCode = result.reason === 'provider_refused' || result.reason === 'provider_unreachable' ? 1 : 0;
}
