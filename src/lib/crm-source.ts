// Sources distantes → bronze chiffré daté → vues privées du dashboard.
import { mkdir, writeFile, readdir, rm, stat, statfs } from "node:fs/promises";
import { join } from "node:path";
import { createHmac, createSign, createHash } from "node:crypto";
import { purgeExpiredBronze } from "./bronze-retention.js";
import { bronzePath } from './data-paths.js';
import { currentDatabasePath } from './db.js';
import { backupKey, encryptBackup, decryptBackup } from "./backup-cipher.js";

export function crmKey(): Buffer {
  return createHmac("sha256", backupKey()).update("openswissdata-crm-v1").digest();
}
export function seal(value: string): string { return encryptBackup(Buffer.from(value), crmKey()).toString("base64"); }
export function unseal(value: string): string { return decryptBackup(Buffer.from(value, "base64"), crmKey()).toString(); }
const bronzeUsage = new Map<string, {nextSweep:number;bytes:number}>();
export function invalidateBronzeUsage(root: string): void { bronzeUsage.delete(root); }
export async function bronze(source: string, raw: Buffer, compartment: "dashboard" | "financial" = "dashboard"): Promise<void> {
  const root = bronzePath(compartment, currentDatabasePath());
  const usage = bronzeUsage.get(root) ?? {nextSweep:0,bytes:0};
  bronzeUsage.set(root,usage);
  const folder = join(root, new Date().toISOString().slice(0, 10));
  await mkdir(folder, { recursive: true, mode: 0o700 });
  if (Date.now() > usage.nextSweep) {
    const purge = await purgeExpiredBronze(root);
    if (purge.failed) throw new Error('crm_bronze_cleanup_failed');
    let total = 0;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
      for (const file of await readdir(join(root, entry.name))) total += (await stat(join(root, entry.name, file))).size;
    }
    usage.bytes = total;
    usage.nextSweep = Date.now() + 3600_000;
  }
  const disk = await statfs(root);
  const limit = compartment === "financial" ? 64_000_000 : 250_000_000;
  if (usage.bytes + raw.length > limit || disk.bavail * disk.bsize < 300_000_000) throw new Error("crm_bronze_capacity");
  const digest = createHash("sha256").update(raw).digest("hex");
  try {
    await writeFile(join(folder, `${source}-${digest}.enc`), encryptBackup(raw, crmKey()), { flag: "wx", mode: 0o600 });
    usage.bytes += raw.length + 36;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}
export async function sourceJson<T>(source: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${source}_http_${response.status}`);
  const parts: Uint8Array[] = []; let bytes = 0;
  if (!response.body) throw new Error(`${source}_empty_response`);
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 5_000_000) throw new Error(`${source}_response_too_large`);
    parts.push(chunk);
  }
  const raw = Buffer.concat(parts);
  await bronze(source, raw, source === "stripe-financial" ? "financial" : "dashboard");
  return JSON.parse(raw.toString()) as T;
}
let cacheGeneration = 0;
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
export async function cached<T>(key: string, duration: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const generation = cacheGeneration;
  const work = fn().then(value => { if (generation === cacheGeneration) cache.set(key, { until: Date.now() + duration, value }); return value; }).finally(() => pending.delete(key));
  pending.set(key, work); return work;
}
export function clearCrmCache(): void { cacheGeneration++; cache.clear(); pending.clear(); }
// Les originaux restent chez Infomaniak ; seules les copies temporaires de ce compte sont retirées.
export async function clearMailboxBronze(account: "support" | "cam_project"): Promise<void> {
  const root = bronzePath('dashboard', currentDatabasePath());
  for (const day of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    for (const name of await readdir(join(root, day.name))) if (name.startsWith(`imap-${account}-`)) await rm(join(root, day.name, name), { force: true });
  }
  bronzeUsage.delete(root);
}

export type SearchRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
export async function searchConsole(days: number) {
  if (!process.env.GSC_SERVICE_ACCOUNT_JSON) return { available: false as const, reason: "Connexion Google non configurée." };
  return cached(`gsc-${days}`, 900_000, async () => {
    const key = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON!) as { client_email: string; private_key: string };
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const claim = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: key.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const signature = createSign("RSA-SHA256").update(claim).sign(key.private_key).toString("base64url");
    // Un jeton d'accès n'est pas une donnée source et ne doit pas être archivé.
    const auth = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${claim}.${signature}` }), signal: AbortSignal.timeout(10_000) });
    if (!auth.ok) throw new Error("gsc_auth_failed");
    const token = await auth.json() as { access_token: string };
    const end = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
    const start = new Date(Date.parse(end) - (days - 1) * 86400_000).toISOString().slice(0, 10);
    const query = (dimensions: string[]) => sourceJson<{ rows?: SearchRow[] }>("gsc", "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aopenswissdata.com/searchAnalytics/query", { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: start, endDate: end, dimensions, rowLimit: dimensions[0] === "date" ? 366 : 20, dataState: "final" }) });
    const [total, queries, pages, daily] = await Promise.all([query([]), query(["query"]), query(["page"]), query(["date"])]);
    return { available: true as const, source: "Google Search Console", checked_at: Date.now(), start, end, total: total.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 }, queries: queries.rows ?? [], pages: pages.rows ?? [], daily: daily.rows ?? [] };
  });
}
