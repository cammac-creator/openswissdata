// Preuve de la tâche osd.T08 : une adresse du bureau absente ne passe plus inaperçue au démarrage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, closeDb } from '../../src/lib/db.js';
import { checkAdminEmailsAtStartup, validAdminAddresses } from '../../src/lib/controle-demarrage.js';

const NOW = Date.UTC(2026, 9, 6, 8, 0);
const TOKEN = '123456789:jeton-fictif-TELEGRAM-abcdefghij';

type Telegram = { calls: Array<{ chat_id: string; text: string }>; status: number; ok: boolean; fail: boolean };

/** Fetch simulé vers Telegram seulement : aucun accès réseau réel. */
function makeFetch(tg: Telegram) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.telegram.org/')) throw new Error(`url inattendue dans le test : ${url}`);
    if (tg.fail) throw new Error('réseau simulé en échec');
    tg.calls.push(JSON.parse(String(init?.body)) as { chat_id: string; text: string });
    if (!tg.ok) return new Response(JSON.stringify({ ok: false }), { status: tg.status });
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
}

const witness = () =>
  getDb().prepare("SELECT checked_at,details_json FROM operation_checks WHERE name='admin_emails_startup'").get() as
    | { checked_at: number; details_json: string }
    | undefined;

describe('Contrôle de démarrage ADMIN_EMAILS (tâche osd.T08)', () => {
  let temp: string;
  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'osd-controle-demarrage-'));
    process.env.DATABASE_PATH = join(temp, 'fictive.sqlite');
    process.env.OSD_VEILLE_TELEGRAM_TOKEN = TOKEN;
    process.env.OSD_VEILLE_TELEGRAM_CHAT = '424242';
  });
  afterEach(() => {
    closeDb();
    rmSync(temp, { recursive: true, force: true });
    for (const name of ['DATABASE_PATH', 'OSD_VEILLE_TELEGRAM_TOKEN', 'OSD_VEILLE_TELEGRAM_CHAT']) delete process.env[name];
    vi.restoreAllMocks();
  });

  it('analyse les adresses comme requireAdmin : virgules, espaces, casse, et une forme minimale valide', () => {
    expect(validAdminAddresses(undefined)).toEqual([]);
    expect(validAdminAddresses('')).toEqual([]);
    expect(validAdminAddresses('  ,  ,')).toEqual([]);
    expect(validAdminAddresses('pas-une-adresse')).toEqual([]);
    expect(validAdminAddresses(' Bureau@OpenSwissData.com , second@exemple.ch ')).toEqual(['bureau@openswissdata.com', 'second@exemple.ch']);
  });

  it('production et ADMIN_EMAILS vide : témoin écrit, un message Telegram sans aucune adresse', async () => {
    const tg: Telegram = { calls: [], status: 200, ok: true, fail: false };
    const result = await checkAdminEmailsAtStartup({
      isProduction: () => true,
      adminEmails: () => '',
      now: () => NOW,
      fetch: makeFetch(tg),
    });
    expect(result).toEqual({ checked: true, alerted: true, code: 'admin_emails_empty' });

    expect(tg.calls).toHaveLength(1);
    expect(tg.calls[0]!.text).toBe(
      "OpenSwissData : ADMIN_EMAILS est vide en production : le bureau n'a plus de compte autorisé. Le renseigner dans les variables du serveur.",
    );
    expect(tg.calls[0]!.text).not.toMatch(/@/);

    const row = witness();
    expect(row).toBeDefined();
    expect(row!.checked_at).toBe(NOW);
    const details = JSON.parse(row!.details_json) as Record<string, unknown>;
    expect(details).toMatchObject({ status: 'error', code: 'admin_emails_empty', alerted: true });
    expect(JSON.stringify(details)).not.toMatch(/@/);
  });

  it("production et ADMIN_EMAILS composé uniquement d'adresses invalides : traité comme vide", async () => {
    const tg: Telegram = { calls: [], status: 200, ok: true, fail: false };
    const result = await checkAdminEmailsAtStartup({
      isProduction: () => true,
      adminEmails: () => 'pas-une-adresse, , texte-quelconque',
      now: () => NOW,
      fetch: makeFetch(tg),
    });
    expect(result.checked).toBe(true);
    expect(tg.calls).toHaveLength(1);
    expect(witness()).toBeDefined();
  });

  it('production et ADMIN_EMAILS renseigné : aucun témoin, aucun message Telegram', async () => {
    const tg: Telegram = { calls: [], status: 200, ok: true, fail: false };
    const result = await checkAdminEmailsAtStartup({
      isProduction: () => true,
      adminEmails: () => 'bureau@openswissdata.com',
      now: () => NOW,
      fetch: makeFetch(tg),
    });
    expect(result).toEqual({ checked: false });
    expect(tg.calls).toHaveLength(0);
    expect(witness()).toBeUndefined();
  });

  it("adresse de nouveau renseignée après une alerte : le témoin repasse à « ok », sans message", async () => {
    const tg: Telegram = { calls: [], status: 200, ok: true, fail: false };
    await checkAdminEmailsAtStartup({ isProduction: () => true, adminEmails: () => '', now: () => NOW, fetch: makeFetch(tg) });
    expect(JSON.parse(witness()!.details_json)).toMatchObject({ status: 'error' });
    const result = await checkAdminEmailsAtStartup({
      isProduction: () => true,
      adminEmails: () => 'bureau@openswissdata.com',
      now: () => NOW + 1_000,
      fetch: makeFetch(tg),
    });
    expect(result).toEqual({ checked: false });
    expect(tg.calls).toHaveLength(1);
    const row = witness()!;
    expect(row.checked_at).toBe(NOW + 1_000);
    expect(JSON.parse(row.details_json)).toEqual({ version: 1, status: 'ok', code: null, alerted: false });
  });

  it('hors production : aucun témoin, aucun message Telegram, même avec ADMIN_EMAILS vide', async () => {
    const tg: Telegram = { calls: [], status: 200, ok: true, fail: false };
    const result = await checkAdminEmailsAtStartup({
      isProduction: () => false,
      adminEmails: () => '',
      now: () => NOW,
      fetch: makeFetch(tg),
    });
    expect(result).toEqual({ checked: false });
    expect(tg.calls).toHaveLength(0);
    expect(witness()).toBeUndefined();
  });

  it('Telegram qui échoue (réseau) : aucune exception, témoin écrit quand même, non marqué alerté', async () => {
    const tg: Telegram = { calls: [], status: 200, ok: true, fail: true };
    const result = await checkAdminEmailsAtStartup({
      isProduction: () => true,
      adminEmails: () => '',
      now: () => NOW,
      fetch: makeFetch(tg),
    });
    expect(result).toEqual({ checked: true, alerted: false, code: 'admin_emails_empty' });
    expect(tg.calls).toHaveLength(0);
    const row = witness();
    expect(row).toBeDefined();
    const details = JSON.parse(row!.details_json) as Record<string, unknown>;
    expect(details).toMatchObject({ status: 'error', code: 'admin_emails_empty', alerted: false });
  });

  it('Telegram qui refuse le message (http non ok) : aucune exception, témoin écrit, non marqué alerté', async () => {
    const tg: Telegram = { calls: [], status: 500, ok: false, fail: false };
    const result = await checkAdminEmailsAtStartup({
      isProduction: () => true,
      adminEmails: () => '',
      now: () => NOW,
      fetch: makeFetch(tg),
    });
    expect(result).toEqual({ checked: true, alerted: false, code: 'admin_emails_empty' });
    expect(tg.calls).toHaveLength(1);
    expect(witness()).toBeDefined();
  });

  it('Telegram non configuré : le témoin seul, aucun appel réseau', async () => {
    delete process.env.OSD_VEILLE_TELEGRAM_TOKEN;
    delete process.env.OSD_VEILLE_TELEGRAM_CHAT;
    const tg: Telegram = { calls: [], status: 200, ok: true, fail: false };
    const result = await checkAdminEmailsAtStartup({
      isProduction: () => true,
      adminEmails: () => '',
      now: () => NOW,
      fetch: makeFetch(tg),
    });
    expect(result).toEqual({ checked: true, alerted: false, code: 'admin_emails_empty' });
    expect(tg.calls).toHaveLength(0);
    expect(witness()).toBeDefined();
  });

  it("l'échec d'écriture du témoin (base indisponible) ne lève aucune exception", async () => {
    const tg: Telegram = { calls: [], status: 200, ok: true, fail: false };
    const result = await checkAdminEmailsAtStartup({
      isProduction: () => true,
      adminEmails: () => '',
      now: () => NOW,
      fetch: makeFetch(tg),
      database: () => { throw new Error('base indisponible (simulé)'); },
    });
    expect(result.checked).toBe(true);
    expect(result.code).toBe('admin_emails_empty');
  });
});
