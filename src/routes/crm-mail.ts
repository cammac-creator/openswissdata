import { Hono } from "hono";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getDb } from "../lib/db.js";
import { cached, sourceJson, bronze, seal, unseal, clearCrmCache } from "../lib/crm-source.js";

export const crmMailRoute = new Hono();
type SentMail = { id: string; from: string; to: string[]; subject: string; created_at: string; last_event: string; text?: string; html?: string };
type MailSummary = { id: string; source: string; from: string; to: string[]; subject: string; created_at: string; status: string; folder?: string };
const ours = (mail: SentMail) => /@openswissdata\.com>?\s*$/i.test(mail.from);
const redact = (text: string) => text
  .replace(/https?:\/\/[^\s<>"']+\/api\/auth\/verify[^\s<>"']*/g, "[lien de connexion personnel masqué]")
  .replace(/https?:\/\/[^\s<>"']+\/api\/download\/[^\s<>"']*/g, "[lien de téléchargement personnel masqué]")
  .replace(/https?:\/\/[^\s<>"']+X-Amz-[^\s<>"']*/gi, "[lien de téléchargement temporaire masqué]");
let imapRetryAfter = 0;
let connectionRetryAfter = 0;
export function connection() {
  const row = getDb().prepare("SELECT secret_encrypted FROM crm_connections WHERE name='support'").get() as { secret_encrypted: string } | undefined;
  if (!row) return null;
  return JSON.parse(unseal(row.secret_encrypted)) as { user: string; pass: string };
}
async function imap<T>(auth: { user: string; pass: string }, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({ host: "mail.infomaniak.com", port: 993, secure: true, auth, logger: false, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, disableAutoIdle: true });
  const timer = setTimeout(() => client.close(), 35_000);
  client.on("error", () => { /* Le résultat de la requête expose l'échec sans journaliser le contenu privé. */ });
  try { await client.connect(); return await run(client); }
  finally { clearTimeout(timer); client.close(); }
}
async function sent() {
  if (!process.env.RESEND_API_KEY) return { available: false, reason: "Envois non connectés.", items: [] as MailSummary[], has_more: false };
  return cached("resend-sent", 60_000, async () => {
    const result = await sourceJson<{ data: SentMail[]; has_more: boolean }>("resend-list", "https://api.resend.com/emails?limit=100", { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
    return { available: true, items: result.data.filter(ours).map(m => ({ id: m.id, source: "resend", from: m.from, to: m.to, subject: m.subject, created_at: m.created_at, status: m.last_event })), has_more: result.has_more };
  });
}
async function inbox() {
  const auth = connection();
  if (!auth) return { available: false, reason: "La boîte de réception Infomaniak reste à connecter.", items: [] as MailSummary[] };
  if (Date.now() < imapRetryAfter) throw new Error("imap_retry_later");
  return cached("imap-support", 90_000, () => imap(auth, async client => {
    const folders = (await client.list()).filter(f => f.path === "INBOX" || ["\\Sent", "\\Junk", "\\Archive"].includes(f.specialUse ?? ""));
    const items: MailSummary[] = [];
    for (const folder of folders.slice(0, 5)) {
      const mailbox = await client.mailboxOpen(folder.path, { readOnly: true });
      const found = await client.search({ since: new Date(Date.now() - 90 * 86400_000) }, { uid: true });
      if (!Array.isArray(found) || !found.length) continue;
      for await (const m of client.fetch(found.slice(-50), { envelope: true, headers: true, flags: true, uid: true, internalDate: true }, { uid: true })) {
        if (m.headers) await bronze("imap-headers", m.headers);
        const e = m.envelope;
        if (!e) continue;
        const id = Buffer.from(JSON.stringify({ folder: folder.path, uid: m.uid, validity: mailbox.uidValidity.toString() })).toString("base64url");
        items.push({ id, source: "imap", folder: folder.path, from: e.from?.map(a => a.address ?? "").join(", ") ?? "", to: e.to?.map(a => a.address ?? "") ?? [], subject: e.subject ?? "Sans objet", created_at: new Date(m.internalDate || e.date || Date.now()).toISOString(), status: m.flags?.has("\\Seen") ? "seen" : "unread" });
      }
    }
    return { available: true, items };
  })).catch(error => { imapRetryAfter = Date.now() + 300_000; throw error; });
}
crmMailRoute.get("/", async c => {
  const [outgoing, incoming] = await Promise.allSettled([sent(), inbox()]);
  const out = outgoing.status === "fulfilled" ? outgoing.value : { available: false, reason: "Les envois sont momentanément indisponibles.", items: [] };
  const inc = incoming.status === "fulfilled" ? incoming.value : { available: false, reason: "Connexion Infomaniak à vérifier.", items: [] };
  return c.json({ checked_at: Date.now(), outgoing: { ...out, items: undefined }, incoming: { ...inc, items: undefined }, items: [...out.items, ...inc.items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)), mailbox: "contact@openswissdata.com" });
});
crmMailRoute.get("/:source/:id", async c => {
  try {
    if (c.req.param("source") === "resend") {
      const id = c.req.param("id");
      if (!/^[a-f0-9-]{36}$/.test(id)) return c.json({ error: "invalid_id" }, 400);
      const m = await sourceJson<SentMail>("resend-detail", `https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
      if (!ours(m)) return c.json({ error: "not_found" }, 404);
      const parsed = m.text ? null : await simpleParser(Buffer.from(`Content-Type: text/html; charset=utf-8\r\n\r\n${m.html ?? ""}`), { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 500_000 });
      return c.json({ subject: m.subject, from: m.from, to: m.to, created_at: m.created_at, status: m.last_event, text: redact(m.text ?? parsed?.text ?? "Contenu non disponible."), attachments: [] });
    }
    if (c.req.param("source") !== "imap") return c.json({ error: "not_found" }, 404);
    const auth = connection();
    if (!auth) return c.json({ error: "not_connected" }, 409);
    const encoded = c.req.param("id");
    if (!/^[A-Za-z0-9_-]{1,1200}$/.test(encoded)) return c.json({ error: "invalid_id" }, 400);
    const id = z.object({ folder: z.string().max(200), uid: z.number().int().positive(), validity: z.string().regex(/^\d+$/) }).parse(JSON.parse(Buffer.from(encoded, "base64url").toString()));
    const result = await imap(auth, async client => {
      const mailbox = await client.mailboxOpen(id.folder, { readOnly: true });
      if (mailbox.uidValidity.toString() !== id.validity) throw new Error("mailbox_changed");
      const m = await client.fetchOne(String(id.uid), { source: { maxLength: 1_000_000 }, size: true }, { uid: true });
      if (!m || !m.source) throw new Error("not_found");
      await bronze("imap-message", m.source);
      const parsed = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 500_000 });
      return { subject: parsed.subject ?? "Sans objet", from: parsed.from?.text ?? "", to: Array.isArray(parsed.to) ? parsed.to.map(a => a.text) : [parsed.to?.text ?? ""], text: redact(parsed.text ?? "Aucun texte disponible."), created_at: parsed.date?.toISOString(), truncated: (m.size ?? 0) > 1_000_000, attachments: parsed.attachments.map(a => ({ name: a.filename ?? "Pièce jointe", size: a.size })) };
    });
    return c.json(result);
  } catch { return c.json({ error: "mail_unavailable" }, 502); }
});
crmMailRoute.post("/connect", async c => {
  const input = z.object({ user: z.literal("contact@openswissdata.com"), pass: z.string().min(1).max(500) }).strict().safeParse(await c.req.json().catch(error => { if (error instanceof SyntaxError) return null; throw error; }));
  if (!input.success) return c.json({ error: "invalid_body" }, 400);
  if (Date.now() < connectionRetryAfter) return c.json({ error: "retry_later" }, 429);
  connectionRetryAfter = Date.now() + 30_000;
  try {
    await imap(input.data, async client => { await client.mailboxOpen("INBOX", { readOnly: true }); });
    getDb().prepare("INSERT INTO crm_connections(name,secret_encrypted,updated_at) VALUES('support',?,?) ON CONFLICT(name) DO UPDATE SET secret_encrypted=excluded.secret_encrypted,updated_at=excluded.updated_at").run(seal(JSON.stringify(input.data)), Date.now());
    imapRetryAfter = 0; clearCrmCache(); return c.json({ ok: true });
  } catch { return c.json({ error: "connection_failed" }, 400); }
});
crmMailRoute.post("/disconnect", c => {
  getDb().prepare("DELETE FROM crm_connections WHERE name='support'").run();
  imapRetryAfter = 0; clearCrmCache(); return c.json({ ok: true });
});
