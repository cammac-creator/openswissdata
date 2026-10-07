// Veille des tâches planifiées du dépôt public (charte osd.B01, seconde pièce, 05.10.2026). Aucune IA.
// Toutes les six heures, sans jeton GitHub : (1) l'état de chaque tâche planifiée du dépôt public (GitHub désactive
// les tâches planifiées après 60 jours sans activité) ; (2) le dernier passage terminé du canari et de la collecte
// FINMA sur main ; (3) une fois par semaine, la page FINMA de recherche des membres OAR (liens de fichiers et mots
// « conseiller » / « Berater ») pour voir paraître le registre public prévu par l'art. 18b LBA.
// Un message Telegram par changement d'état, par le canal de la veille courrier (mêmes variables, aucune nouvelle clé).
// Un refus GitHub ou FINMA (403, 429, réseau) vaut « non vérifiable », jamais « désactivée » ; il n'alerte qu'après
// 24 heures. Témoin `operation_checks/workflow_watch` : dates, états, empreinte ; aucune donnée personnelle.
// Limite connue (vérification du 02.10.2026) : sans jeton, GitHub accorde 60 lectures par heure PAR ADRESSE, et
// l'adresse de sortie de Railway peut être partagée avec d'autres clients. Si « non vérifiable » revient chaque jour,
// la suite est un jeton GitHub en lecture seule : création de clé (F3), donc proposition à Claude-Alain, jamais
// posée d'office.
// Démarré uniquement dans le point d'entrée réel (src/index.ts), jamais dans createApp().
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from './db.js';

const CHECK = 'workflow_watch';
const START_DELAY = 120_000;
const INTERVAL = 6 * 3_600_000;
const WEEK = 7 * 86_400_000;
const UNVERIFIABLE_GRACE = 24 * 3_600_000;
const HTTP_TIMEOUT = 15_000;
const BODY_LIMIT = 2_000_000;
const TELEGRAM_TIMEOUT = 10_000;
const TELEGRAM_LIMIT = 4_000;
const REPO = process.env.OSD_GITHUB_REPO?.trim() || 'cammac-creator/openswissdata';
const SCHEDULED = ['refresh-finma.yml', 'refresh-tares.yml', 'monitor-sources.yml', 'monitor-public.yml', 'backup-db.yml',
  'cleanup-expired.yml', 'indexnow.yml', 'dependency-audit.yml',
  // Collectes ajoutées les 06-07.10.2026 : une désactivation par GitHub ne doit jamais passer inaperçue.
  'refresh-localities.yml', 'refresh-streets.yml', 'refresh-finma-seats.yml', 'refresh-bfe-pv.yml', 'prospect-sources.yml',
  // Tâche osd.jeux, piste G1/G2 (07.10.2026) : moteur générique de jeux ouverts.
  'refresh-datasets.yml'] as const;
const WATCHED_RUNS: Readonly<Record<string, string>> = { 'monitor-sources.yml': 'Canari des 20 sources', 'refresh-finma.yml': 'Collecte FINMA' };
const FINMA_OAR_PAGE = 'https://www.finma.ch/fr/autorisation/organisme-d-autoregulation-oar/recherche-de-membres-oar/';
const UA = 'OpenSwissData-veille-taches/1';

type Conclusion = 'success' | 'failure' | 'other';
type Status = 'ok' | 'inactive' | 'unverifiable' | 'error';
type State = {
  version: 1;
  checked_at: number;
  status: Status;
  code: string | null;
  http_status: number | null;
  workflows: Record<string, string>;
  runs: Record<string, Conclusion>;
  finma_oar_hash: string | null;
  finma_oar_checked_at: number | null;
  unverifiable_since: number | null;
  unverifiable_alerted: boolean;
  total_alerted: number;
};
type Fetcher = typeof fetch;
type Dependencies = { database: () => Database.Database; now: () => number; fetch: Fetcher };
const defaults: Dependencies = {
  database: getDb,
  // Lue à chaque appel, pas au chargement : une horloge simulée (tests) doit être vue (incident du 05.10).
  now: () => Date.now(),
  fetch: (input, init) => fetch(input, init),
};

class Unverifiable extends Error {}

type TelegramConfig = { token: string; chat: string };
type Sent = { ok: true } | { ok: false; code: 'telegram_http' | 'telegram_timeout' | 'telegram_network' | 'telegram_not_ok'; http_status?: number };

// Coupe par point de code : une moitié de paire de substitution rendrait le texte invalide pour Telegram.
const clip = (text: string, max: number) => { const chars = Array.from(text); return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text; };

async function getText(fetcher: Fetcher, url: string, accept: string): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept, 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(HTTP_TIMEOUT) });
  } catch {
    throw new Unverifiable('network');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Unverifiable(`http_${response.status}`);
  }
  const text = await response.text();
  if (text.length > BODY_LIMIT) throw new Unverifiable('too_large');
  return text;
}

async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
  const text = await getText(fetcher, url, 'application/vnd.github+json');
  try { return JSON.parse(text) as unknown; } catch { throw new Unverifiable('json'); }
}

/** États des tâches planifiées, par nom de fichier. */
export async function readWorkflowStates(fetcher: Fetcher): Promise<Record<string, string>> {
  const body = await getJson(fetcher, `https://api.github.com/repos/${REPO}/actions/workflows?per_page=100`) as { workflows?: { path?: string; state?: string }[] };
  const states: Record<string, string> = {};
  for (const w of body.workflows ?? []) {
    const file = String(w.path ?? '').split('/').pop() ?? '';
    if ((SCHEDULED as readonly string[]).includes(file)) states[file] = String(w.state ?? 'unknown').slice(0, 64);
  }
  return states;
}

export async function readLastConclusion(fetcher: Fetcher, file: string): Promise<Conclusion | null> {
  const body = await getJson(fetcher, `https://api.github.com/repos/${REPO}/actions/workflows/${file}/runs?branch=main&status=completed&per_page=1`) as { workflow_runs?: { conclusion?: string }[] };
  const c = body.workflow_runs?.[0]?.conclusion;
  if (!c) return null;
  return c === 'success' ? 'success' : c === 'failure' ? 'failure' : 'other';
}

/** Empreinte de la page FINMA : liens de fichiers et présence des mots qui annonceraient le registre des conseillers. */
export function finmaOarFingerprint(html: string): string {
  const links = [...html.matchAll(/href="([^"]+\.(?:xlsx|xls|csv|pdf)(?:\?[^"]*)?)"/gi)].map(m => (m[1] ?? '').split('?')[0].toLowerCase());
  const words = ['conseiller', 'berater', 'registre', 'register'].filter(w => html.toLowerCase().includes(w));
  return createHash('sha256').update(JSON.stringify({ links: [...new Set(links)].sort(), words })).digest('hex').slice(0, 32);
}

export function describeChanges(previous: State | null, next: Pick<State, 'workflows' | 'runs'>): string[] {
  const lines: string[] = [];
  for (const [file, state] of Object.entries(next.workflows)) {
    const before = previous?.workflows[file];
    if (state !== 'active' && before !== state) lines.push(`Tâche ${file} : état « ${state} » (GitHub ne la lance plus). La réactiver dans l'onglet Actions du dépôt.`);
    if (state === 'active' && before && before !== 'active') lines.push(`Tâche ${file} : de nouveau active.`);
  }
  for (const [file, conclusion] of Object.entries(next.runs)) {
    const before = previous?.runs[file];
    const label = WATCHED_RUNS[file] ?? file;
    if (conclusion === 'failure' && before !== 'failure') lines.push(`${label} : dernier passage en échec. Consulter le résumé de la tâche dans GitHub.`);
    if (conclusion === 'success' && before === 'failure') lines.push(`${label} : retour à la normale.`);
  }
  return lines;
}

function telegramConfig(): TelegramConfig | 'missing' | 'invalid' {
  const token = process.env.OSD_VEILLE_TELEGRAM_TOKEN?.trim() ?? '';
  const chat = process.env.OSD_VEILLE_TELEGRAM_CHAT?.trim() ?? '';
  if (!token || !chat) return 'missing';
  // Le jeton entre dans le chemin de l'adresse : un format inattendu n'est jamais envoyé.
  if (!/^\d{1,20}:[A-Za-z0-9_-]{20,100}$/.test(token) || !/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/.test(chat)) return 'invalid';
  return { token, chat };
}

async function sendTelegram(config: TelegramConfig, text: string, fetcher: Fetcher): Promise<Sent> {
  let response: Response;
  try {
    response = await fetcher(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chat, text: clip(text, TELEGRAM_LIMIT), link_preview_options: { is_disabled: true } }),
      redirect: 'error',
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT),
    });
  } catch (error) {
    // Le message d'une erreur réseau peut citer l'adresse, donc le jeton : seul un code fermé est gardé.
    return { ok: false, code: error instanceof Error && error.name === 'TimeoutError' ? 'telegram_timeout' : 'telegram_network' };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: 'telegram_http', http_status: response.status };
  }
  const body: unknown = await response.json().catch(() => null);
  return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true ? { ok: true } : { ok: false, code: 'telegram_not_ok' };
}

const STATUS_VALUES: ReadonlySet<Status> = new Set(['ok', 'inactive', 'unverifiable', 'error']);
const CONCLUSIONS: ReadonlySet<string> = new Set(['success', 'failure', 'other']);
const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0);
const stamp = (value: unknown) => (Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null);

function readWorkflows(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const file of SCHEDULED) {
    const v = (value as Record<string, unknown>)[file];
    if (typeof v === 'string') out[file] = v.slice(0, 64);
  }
  return out;
}
function readRuns(value: unknown): Record<string, Conclusion> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, Conclusion> = {};
  for (const file of Object.keys(WATCHED_RUNS)) {
    const v = (value as Record<string, unknown>)[file];
    if (typeof v === 'string' && CONCLUSIONS.has(v)) out[file] = v as Conclusion;
  }
  return out;
}

function readState(db: Database.Database): State | null {
  const row = db.prepare('SELECT checked_at,details_json FROM operation_checks WHERE name=?').get(CHECK) as { checked_at: number; details_json: string } | undefined;
  if (!row) return null;
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(row.details_json) as Record<string, unknown>; } catch { return null; }
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return null;
  return {
    version: 1,
    checked_at: row.checked_at,
    status: typeof raw.status === 'string' && STATUS_VALUES.has(raw.status as Status) ? (raw.status as Status) : 'error',
    code: typeof raw.code === 'string' && /^[a-z0-9_]{1,40}$/.test(raw.code) ? raw.code : null,
    http_status: Number.isSafeInteger(raw.http_status) && (raw.http_status as number) >= 100 && (raw.http_status as number) < 600 ? (raw.http_status as number) : null,
    workflows: readWorkflows(raw.workflows),
    runs: readRuns(raw.runs),
    finma_oar_hash: typeof raw.finma_oar_hash === 'string' && /^[0-9a-f]{32}$/.test(raw.finma_oar_hash) ? raw.finma_oar_hash : null,
    finma_oar_checked_at: stamp(raw.finma_oar_checked_at),
    unverifiable_since: stamp(raw.unverifiable_since),
    unverifiable_alerted: !!raw.unverifiable_alerted,
    total_alerted: count(raw.total_alerted),
  };
}

function save(db: Database.Database, state: State): State {
  db.prepare('INSERT INTO operation_checks(name,checked_at,details_json) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json')
    .run(CHECK, state.checked_at, JSON.stringify(state));
  return state;
}

/** Un passage complet. Un état n'est mémorisé comme « signalé » qu'après ok:true de Telegram. */
export async function runWorkflowWatch(overrides: Partial<Dependencies> = {}): Promise<State> {
  const deps: Dependencies = { ...defaults, ...overrides };
  const db = deps.database();
  const now = deps.now();
  const previous = readState(db);
  const base: State = previous ?? {
    version: 1, checked_at: now, status: 'ok', code: null, http_status: null, workflows: {}, runs: {},
    finma_oar_hash: null, finma_oar_checked_at: null, unverifiable_since: null, unverifiable_alerted: false, total_alerted: 0,
  };
  const telegram = telegramConfig();
  if (telegram === 'missing') return save(db, { ...base, checked_at: now, status: 'inactive', code: 'not_configured', http_status: null });
  if (telegram === 'invalid') return save(db, { ...base, checked_at: now, status: 'inactive', code: 'telegram_config_invalid', http_status: null });

  let workflows: Record<string, string>;
  const runs: Record<string, Conclusion> = {};
  try {
    workflows = await readWorkflowStates(deps.fetch);
    for (const file of Object.keys(WATCHED_RUNS)) {
      const c = await readLastConclusion(deps.fetch, file);
      if (c) runs[file] = c;
    }
  } catch (error) {
    if (!(error instanceof Unverifiable)) throw error;
    const since = base.unverifiable_since ?? now;
    let alerted = base.unverifiable_alerted;
    if (!alerted && now - since >= UNVERIFIABLE_GRACE) {
      const sent = await sendTelegram(telegram, `OpenSwissData : l'état des tâches GitHub n'a pas pu être lu depuis plus de 24 heures (${error.message}). Ce n'est pas une panne prouvée ; vérifier l'onglet Actions du dépôt.`, deps.fetch);
      alerted = sent.ok;
    }
    return save(db, {
      ...base, checked_at: now, status: 'unverifiable', code: error.message, http_status: null,
      unverifiable_since: since, unverifiable_alerted: alerted, total_alerted: base.total_alerted + (alerted && !base.unverifiable_alerted ? 1 : 0),
    });
  }

  // GitHub a répondu : l'éventuel état « non vérifiable » est terminé, même si le message ci-dessous échoue.
  const changes = describeChanges(previous, { workflows, runs });
  if (changes.length) {
    const sent = await sendTelegram(telegram, ['OpenSwissData, veille des tâches :', ...changes.map(l => `- ${l}`)].join('\n'), deps.fetch);
    if (!sent.ok) {
      // L'état précédent (workflows/runs) est gardé : le même changement sera recalculé et renvoyé au passage suivant.
      return save(db, { ...base, checked_at: now, status: 'error', code: sent.code, http_status: sent.http_status ?? null, unverifiable_since: null, unverifiable_alerted: false });
    }
  }
  let state: State = {
    ...base, checked_at: now, status: 'ok', code: null, http_status: null, workflows, runs,
    unverifiable_since: null, unverifiable_alerted: false, total_alerted: base.total_alerted + (changes.length ? 1 : 0),
  };

  if (!state.finma_oar_checked_at || now - state.finma_oar_checked_at >= WEEK) {
    try {
      const hash = finmaOarFingerprint(await getText(deps.fetch, FINMA_OAR_PAGE, 'text/html'));
      if (state.finma_oar_hash && hash !== state.finma_oar_hash) {
        const sent = await sendTelegram(telegram, `OpenSwissData : la page FINMA de recherche des membres OAR a changé (liens de fichiers ou mention des conseillers). Le registre public de l'art. 18b LBA est peut-être paru : ${FINMA_OAR_PAGE}`, deps.fetch);
        if (!sent.ok) return save(db, { ...state, status: 'error', code: sent.code, http_status: sent.http_status ?? null });
        state = { ...state, total_alerted: state.total_alerted + 1 };
      }
      state = { ...state, finma_oar_hash: hash, finma_oar_checked_at: now };
    } catch (error) {
      if (!(error instanceof Unverifiable)) throw error;
      // Page FINMA illisible : on réessaie au passage suivant, sans alerte ni changement de statut.
    }
  }
  return save(db, state);
}

/** Minuterie du point d'entrée réel : premier passage après deux minutes, puis toutes les six heures. */
export function startWorkflowWatch(overrides: Partial<Dependencies> & { run?: () => Promise<State> } = {}): () => void {
  const { run = () => runWorkflowWatch(overrides) } = overrides;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
    timer.unref();
  };
  const tick = async () => {
    if (stopped) return;
    try {
      const result = await run();
      // Codes fermés et nombres seulement : jamais d'adresse, de jeton ni de message d'erreur brut.
      if (result.status !== 'ok') console.info(`[veille des tâches] passage ${result.status} (${result.code ?? 'sans code'})`);
    } catch {
      console.error('[veille des tâches] passage interrompu ; nouvel essai dans six heures');
    } finally {
      // Une seule minuterie, réarmée après la fin : aucun passage concurrent ni relance après arrêt.
      schedule(INTERVAL);
    }
  };
  schedule(START_DELAY);
  console.info('[veille des tâches] minuterie active ; premier passage après deux minutes');
  return () => { stopped = true; clearTimeout(timer); };
}
