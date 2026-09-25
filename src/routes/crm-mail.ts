import { Hono } from "hono";
import { stream } from "hono/streaming";
import { currentMessage, detectLanguage } from "../lib/crm-language.js";
import { isLanguage } from "../lib/languages.js";
import { translateMessage, translationBusy } from "../lib/crm-translation.js";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getDb } from "../lib/db.js";
import { cached, sourceJson, bronze, seal, unseal, clearCrmCache, clearMailboxBronze } from "../lib/crm-source.js";

export const crmMailRoute = new Hono();
type SentMail = { id: string; from: string; to: string[]; subject: string; created_at: string; last_event: string; text?: string; html?: string };
type MailSummary = { mailbox?: string; id: string; source: string; from: string; to: string[]; subject: string; created_at: string; status: string; folder?: string };
const ours = (mail: SentMail) => /@openswissdata\.com>?\s*$/i.test(mail.from);
const redact = (text: string) => text
  .replace(/https?:\/\/[^\s<>"']+\/api\/auth\/verify[^\s<>"']*/g, "[lien de connexion personnel masqué]")
  .replace(/https?:\/\/[^\s<>"']+\/api\/download\/[^\s<>"']*/g, "[lien de téléchargement personnel masqué]")
  .replace(/https?:\/\/[^\s<>"']+X-Amz-[^\s<>"']*/gi, "[lien de téléchargement temporaire masqué]");
const accounts = () => ({ support: "contact@openswissdata.com", cam_project: process.env.CRM_PROJECT_MAILBOX?.trim().toLowerCase() ?? "" });
type Account = "support" | "cam_project";
const projectSearch = () => ({ not: { or: [{ subject: "connexion openswissdata" }, { subject: "openswissdata sign-in" }, { subject: "openswissdata-Anmeldelink" }] }, or: [{ from: "@openswissdata.com" }, { to: "@openswissdata.com" }, { cc: "@openswissdata.com" }, { subject: "openswissdata" }, { body: "openswissdata" }] });
const imapRetryAfter = new Map<Account, number>();
const connectionRetryAfter = new Map<Account, number>();
export function connection(account: Account = "support") {
  const row = getDb().prepare("SELECT secret_encrypted FROM crm_connections WHERE name=?").get(account) as { secret_encrypted: string } | undefined;
  if (!row) return null;
  const auth = JSON.parse(unseal(row.secret_encrypted)) as { user: string; pass: string };
  if (!accounts()[account] || auth.user !== accounts()[account]) throw new Error("mailbox_configuration_changed");
  return auth;
}
const activeClients = new Map<string, Set<ImapFlow>>();
const activeReads = new Map<string, Set<Promise<unknown>>>();
async function imap<T>(auth: { user: string; pass: string }, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({ host: "mail.infomaniak.com", port: 993, secure: true, auth, logger: false, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, disableAutoIdle: true });
  const clients = activeClients.get(auth.user) ?? new Set<ImapFlow>();
  clients.add(client); activeClients.set(auth.user, clients);
  const timer = setTimeout(() => client.close(), 35_000);
  client.on("error", () => { /* Le résultat de la requête expose l'échec sans journaliser le contenu privé. */ });
  const work = (async () => { try { await client.connect(); return await run(client); } finally { clearTimeout(timer); client.close(); clients.delete(client); } })();
  const reads = activeReads.get(auth.user) ?? new Set<Promise<unknown>>();
  reads.add(work); activeReads.set(auth.user, reads);
  try { return await work; } finally { reads.delete(work); }
}
function assertConnection(account: Account, auth: { user: string; pass: string }): void {
  const current = connection(account);
  if (!current || current.user !== auth.user || current.pass !== auth.pass) throw new Error("mailbox_disconnected");
}
async function sent() {
  if (!process.env.RESEND_API_KEY) return { available: false, reason: "Envois non connectés.", items: [] as MailSummary[], has_more: false };
  return cached("resend-sent", 60_000, async () => {
    const result = await sourceJson<{ data: SentMail[]; has_more: boolean }>("resend-list", "https://api.resend.com/emails?limit=100", { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
    return { available: true, items: result.data.filter(ours).map(m => ({ id: m.id, source: "resend", from: m.from, to: m.to, subject: m.subject, created_at: m.created_at, status: m.last_event })), has_more: result.has_more };
  });
}
async function inbox(account: Account) {
  const auth = connection(account);
  if (!auth) return { available: false, reason: "La boîte de réception Infomaniak reste à connecter.", items: [] as MailSummary[] };
  if (Date.now() < (imapRetryAfter.get(account) ?? 0)) throw new Error("imap_retry_later");
  const result = await cached(`imap-${account}`, 90_000, () => imap(auth, async client => {
    const folders = (await client.list()).filter(f => f.path === "INBOX" || ["\\Sent", "\\Junk", "\\Archive"].includes(f.specialUse ?? ""));
    const items: MailSummary[] = [];
    for (const folder of folders.slice(0, 5)) {
      const mailbox = await client.mailboxOpen(folder.path, { readOnly: true });
      const found = await client.search({ since: new Date(Date.now() - 90 * 86400_000), ...(account === "cam_project" ? projectSearch() : {}) }, { uid: true });
      if (!Array.isArray(found) || !found.length) continue;
      for await (const m of client.fetch(found.slice(-50), { envelope: true, headers: true, flags: true, uid: true, internalDate: true }, { uid: true })) {
        assertConnection(account, auth);
        if (m.headers) await bronze(`imap-${account}-headers`, m.headers);
        const e = m.envelope;
        if (!e) continue;
        const id = Buffer.from(JSON.stringify({ account, folder: folder.path, uid: m.uid, validity: mailbox.uidValidity.toString() })).toString("base64url");
        items.push({ id, source: "imap", mailbox: accounts()[account], folder: folder.path, from: e.from?.map(a => a.address ?? "").join(", ") ?? "", to: e.to?.map(a => a.address ?? "") ?? [], subject: e.subject ?? "Sans objet", created_at: new Date(m.internalDate || e.date || Date.now()).toISOString(), status: m.flags?.has("\\Seen") ? "seen" : "unread" });
      }
    }
    return { available: true, items };
  })).catch(error => { imapRetryAfter.set(account, Date.now() + 300_000); throw error; });
  assertConnection(account, auth); return result;
}
crmMailRoute.get("/", async c => {
  const configured = (Object.keys(accounts()) as Account[]).filter(id => accounts()[id]);
  const [outgoing, ...results] = await Promise.allSettled([sent(), ...configured.map(inbox)]);
  const out = outgoing.status === "fulfilled" ? outgoing.value : { available: false, reason: "Les envois sont momentanément indisponibles.", items: [] };
  const incoming = results.map((result, index) => {
    const id = configured[index];
    const value = result.status === "fulfilled" ? result.value : { available: false, reason: "Connexion Infomaniak à vérifier.", items: [] as MailSummary[] };
    return { ...value, id, email: accounts()[id], scope: id === "cam_project" ? "Messages OpenSwissData uniquement" : "Boîte de support" };
  });
  return c.json({ checked_at: Date.now(), outgoing: { ...out, items: undefined }, incoming: { available: incoming.every(a => a.available), accounts: incoming.map(a => ({ ...a, items: undefined })) }, items: [...out.items, ...incoming.flatMap(a => a.items)].map(m => ({ ...m, language: { ...detectLanguage(m.subject), basis: "subject" } })).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) });
});
crmMailRoute.get("/:source/:id", async c => {
  try {
    if (c.req.param("source") === "resend") {
      const id = c.req.param("id");
      if (!/^[a-f0-9-]{36}$/.test(id)) return c.json({ error: "invalid_id" }, 400);
      const m = await sourceJson<SentMail>("resend-detail", `https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
      if (!ours(m)) return c.json({ error: "not_found" }, 404);
      const parsed = m.text ? null : await simpleParser(Buffer.from(`Content-Type: text/html; charset=utf-8\r\n\r\n${m.html ?? ""}`), { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 500_000 });
      const text = redact(m.text ?? parsed?.text ?? "Contenu non disponible.");
      return c.json({ language: detectLanguage(text), reading_text: currentMessage(text), subject: m.subject, from: m.from, to: m.to, created_at: m.created_at, status: m.last_event, text, attachments: [] });
    }
    if (c.req.param("source") !== "imap") return c.json({ error: "not_found" }, 404);
    const encoded = c.req.param("id");
    if (!/^[A-Za-z0-9_-]{1,1200}$/.test(encoded)) return c.json({ error: "invalid_id" }, 400);
    const id = z.object({ account: z.enum(["support", "cam_project"]).default("support"), folder: z.string().max(200), uid: z.number().int().positive(), validity: z.string().regex(/^\d+$/) }).parse(JSON.parse(Buffer.from(encoded, "base64url").toString()));
    const auth = connection(id.account);
    if (!auth) return c.json({ error: "not_connected" }, 409);
    const result = await imap(auth, async client => {
      const folders = (await client.list()).filter(f => f.path === "INBOX" || ["\\Sent", "\\Junk", "\\Archive"].includes(f.specialUse ?? ""));
      if (!folders.slice(0, 5).some(f => f.path === id.folder)) throw new Error("folder_outside_scope");
      const mailbox = await client.mailboxOpen(id.folder, { readOnly: true });
      if (mailbox.uidValidity.toString() !== id.validity) throw new Error("mailbox_changed");
      // Vérifier le périmètre avant de charger ou archiver un message personnel.
      if (id.account === "cam_project") {
        const allowed = await client.search({ uid: String(id.uid), since: new Date(Date.now() - 90 * 86400_000), ...projectSearch() }, { uid: true });
        if (!Array.isArray(allowed) || !allowed.includes(id.uid)) throw new Error("outside_project");
      }
      const m = await client.fetchOne(String(id.uid), { source: { maxLength: 1_000_000 }, size: true }, { uid: true });
      if (!m || !m.source) throw new Error("not_found");
      assertConnection(id.account, auth);
      await bronze(`imap-${id.account}-message`, m.source);
      const parsed = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 500_000 });
      return { subject: parsed.subject ?? "Sans objet", from: parsed.from?.text ?? "", to: Array.isArray(parsed.to) ? parsed.to.map(a => a.text) : [parsed.to?.text ?? ""], text: redact(parsed.text ?? "Aucun texte disponible."), created_at: parsed.date?.toISOString(), truncated: (m.size ?? 0) > 1_000_000, attachments: parsed.attachments.map(a => ({ name: a.filename ?? "Pièce jointe", size: a.size })) };
    });
    assertConnection(id.account, auth);
    return c.json({ ...result, language: detectLanguage(result.text), reading_text: currentMessage(result.text) });
  } catch { return c.json({ error: "mail_unavailable" }, 502); }
});
crmMailRoute.post("/translate", async c => {
  const input = z.object({ language: z.string().refine(isLanguage), text: z.string().trim().min(1).max(5000) }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!input.success) return c.json({ error: "invalid_body" }, 400);
  if (translationBusy()) return c.json({ error: "translation_busy" }, 429);
  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "private, no-store, no-transform");
  c.header("X-Accel-Buffering", "no");
  return stream(c, async output => {
    const abort = new AbortController();
    output.onAbort(() => abort.abort());
    const emit = async (event: unknown) => { await output.write(JSON.stringify(event) + "\n"); };
    await emit({type:"waiting"});
    const heartbeat = setInterval(() => { emit({type:"waiting"}).catch(() => abort.abort()); }, 10_000);
    try {
      if (input.data.language === "fr") { await emit({ type:"chunk", text:input.data.text, completed:1, total:1 }); await emit({type:"done"}); }
      else await translateMessage(input.data.text, input.data.language, abort.signal, emit);
    } catch (error) {
      if (!abort.signal.aborted) await emit({ type:"error", error:error instanceof Error && ["translation_timeout", "translation_truncated", "translation_busy"].includes(error.message) ? error.message : "translation_failed" });
    } finally { clearInterval(heartbeat); }
  });
});
crmMailRoute.post("/connect", async c => {
  const input = z.object({ user: z.string().email().refine(user => Object.values(accounts()).includes(user)), pass: z.string().min(1).max(500), personal_scope_ack: z.boolean().optional() }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!input.success) return c.json({ error: "invalid_body" }, 400);
  const account: Account = input.data.user === accounts().support ? "support" : "cam_project";
  if (account === "cam_project" && input.data.personal_scope_ack !== true) return c.json({ error: "personal_scope_not_acknowledged" }, 400);
  if (Date.now() < (connectionRetryAfter.get(account) ?? 0)) return c.json({ error: "retry_later" }, 429);
  connectionRetryAfter.set(account, Date.now() + 30_000);
  try {
    await imap(input.data, async client => { await client.mailboxOpen("INBOX", { readOnly: true }); });
    getDb().prepare("INSERT INTO crm_connections(name,secret_encrypted,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET secret_encrypted=excluded.secret_encrypted,updated_at=excluded.updated_at").run(account, seal(JSON.stringify(input.data)), Date.now());
    imapRetryAfter.delete(account); clearCrmCache(); return c.json({ ok: true });
  } catch { return c.json({ error: "connection_failed" }, 400); }
});
crmMailRoute.post("/disconnect", async c => {
  const input = z.object({ user: z.string().email().refine(user => Object.values(accounts()).includes(user)) }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!input.success) return c.json({ error: "invalid_body" }, 400);
  const account: Account = input.data.user === accounts().support ? "support" : "cam_project";
  getDb().prepare("DELETE FROM crm_connections WHERE name=?").run(account);
  clearCrmCache();
  for (const client of activeClients.get(input.data.user) ?? []) client.close();
  await Promise.allSettled([...(activeReads.get(input.data.user) ?? [])]);
  await clearMailboxBronze(account);
  imapRetryAfter.delete(account); return c.json({ ok: true });
});
