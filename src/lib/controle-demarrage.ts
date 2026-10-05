// Contrôle de démarrage (tâche osd.T08) : une adresse du bureau absente ne passe plus inaperçue.
// Règle (.claude/rules/conservation-et-sauvegarde.md, 29.09.2026) : « Garder ADMIN_EMAILS renseigné : c'est la
// protection principale du compte du bureau. » /api/health/deep exige lui-même une session administrateur
// (requireAdmin) : il ne peut donc pas signaler l'absence de ce compte. Ce contrôle le fait au démarrage réel.
//
// Un seul passage, en production seulement, jamais dans createApp(). Jamais bloquant : aucune exception ne
// remonte, aucun impact sur /api/health ni /api/health/ready (démarrage attendu par l'hébergeur). Témoin
// `operation_checks/admin_emails_startup` (code fermé, aucune adresse) ; alerte Telegram par le même canal que
// la veille courrier (OSD_VEILLE_TELEGRAM_TOKEN / OSD_VEILLE_TELEGRAM_CHAT), sans adresse dans le message.
import type Database from 'better-sqlite3';
import { getDb } from './db.js';

const CHECK = 'admin_emails_startup';
const TELEGRAM_TIMEOUT = 10_000;
const ALERT_TEXT =
  "OpenSwissData : ADMIN_EMAILS est vide en production : le bureau n'a plus de compte autorisé. Le renseigner dans les variables du serveur.";

type TelegramConfig = { token: string; chat: string };
type Sent =
  | { ok: true }
  | { ok: false; code: 'telegram_http' | 'telegram_timeout' | 'telegram_network' | 'telegram_not_ok'; http_status?: number };

type Dependencies = {
  database: () => Database.Database;
  now: () => number;
  fetch: typeof fetch;
  isProduction: () => boolean;
  adminEmails: () => string | undefined;
};
const defaults: Dependencies = {
  database: getDb,
  // Lue à chaque appel, pas au chargement : une horloge simulée (tests) doit être vue.
  now: () => Date.now(),
  fetch: (input, init) => fetch(input, init),
  isProduction: () => process.env.NODE_ENV === 'production',
  adminEmails: () => process.env.ADMIN_EMAILS,
};

/**
 * Même analyse que `requireAdmin` (admin-middleware.ts) : virgules, espaces, casse ; en plus une forme minimale
 * d'adresse, pour qu'une valeur renseignée mais illisible (espace seul, texte sans « @ ») ne compte pas comme
 * protégeant le compte du bureau.
 */
export function validAdminAddresses(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

function telegramConfig(): TelegramConfig | 'missing' | 'invalid' {
  const token = process.env.OSD_VEILLE_TELEGRAM_TOKEN?.trim() ?? '';
  const chat = process.env.OSD_VEILLE_TELEGRAM_CHAT?.trim() ?? '';
  if (!token || !chat) return 'missing';
  // Le jeton entre dans le chemin de l'adresse : un format inattendu n'est jamais envoyé.
  if (!/^\d{1,20}:[A-Za-z0-9_-]{20,100}$/.test(token) || !/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/.test(chat)) return 'invalid';
  return { token, chat };
}

async function sendTelegram(config: TelegramConfig, text: string, fetcher: typeof fetch): Promise<Sent> {
  let response: Response;
  try {
    response = await fetcher(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chat, text, link_preview_options: { is_disabled: true } }),
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

function save(db: Database.Database, now: number, alerted: boolean): void {
  db.prepare(
    'INSERT INTO operation_checks(name,checked_at,details_json) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at,details_json=excluded.details_json',
  ).run(CHECK, now, JSON.stringify({ version: 1, status: 'error', code: 'admin_emails_empty', alerted }));
}

export type AdminEmailsStartupResult =
  | { checked: false }
  | { checked: true; alerted: boolean; code: 'admin_emails_empty' | 'startup_check_failed' };

/**
 * Un seul passage, à appeler depuis le point d'entrée réel (src/index.ts), jamais depuis createApp(). Ne lève
 * jamais : une anomalie reste visible en console, sans jamais empêcher le serveur de s'ouvrir.
 */
export async function checkAdminEmailsAtStartup(overrides: Partial<Dependencies> = {}): Promise<AdminEmailsStartupResult> {
  const deps: Dependencies = { ...defaults, ...overrides };
  try {
    if (!deps.isProduction()) return { checked: false };
    if (validAdminAddresses(deps.adminEmails()).length) return { checked: false };

    let alerted = false;
    const telegram = telegramConfig();
    if (telegram !== 'missing' && telegram !== 'invalid') {
      try { alerted = (await sendTelegram(telegram, ALERT_TEXT, deps.fetch)).ok; }
      catch { alerted = false; }
    }
    try { save(deps.database(), deps.now(), alerted); }
    catch { console.error('[démarrage] témoin ADMIN_EMAILS non écrit (base indisponible)'); }

    console.error("[démarrage] ADMIN_EMAILS est vide en production : le bureau n'a plus de compte autorisé.");
    return { checked: true, alerted, code: 'admin_emails_empty' };
  } catch {
    // Jamais bloquant : le service s'ouvre même si ce contrôle échoue entièrement. Code fermé seulement.
    console.error('[démarrage] contrôle ADMIN_EMAILS interrompu');
    return { checked: true, alerted: false, code: 'startup_check_failed' };
  }
}
