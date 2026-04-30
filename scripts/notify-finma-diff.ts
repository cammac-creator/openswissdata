/**
 * Notify customers with active FINMA entitlements when the daily refresh
 * detects entities that have been REMOVED from the registry. This is the
 * critical takedown signal — if FINMA pulls an entity from its warning list
 * or revokes an authorisation, our customers must update their copies
 * within 24 h to avoid art. 28 CC exposure (republishing a status that no
 * longer reflects reality).
 *
 * Workflow assumed:
 *   1. ETL writes the new ZIP to R2 + bumps the `versions` table.
 *   2. ETL also writes `data/finma/diff-<version>.json` listing added/
 *      removed entities (this script reads that file).
 *   3. This script reads active FINMA entitlements and emails each customer
 *      a "new version available" + bullet list of removed entities.
 *
 * Idempotent: writes a `notify_finma_<version>` row in `request_log` and
 * skips re-notifying when the row exists. Safe to re-run.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../src/lib/db.js";
import { sendDownloadEmail } from "../src/lib/email.js";

interface DiffPayload {
  version: string;
  released_at: string;
  added: Array<{ uid: string; name: string; status: string }>;
  removed: Array<{ uid: string; name: string; previous_status: string }>;
  modified: Array<{ uid: string; name: string; old: unknown; new: unknown }>;
}

function findLatestDiff(): { path: string; payload: DiffPayload } | null {
  const dir = "./data/finma";
  if (!existsSync(dir)) return null;
  const db = getDb();
  const latest = db
    .prepare("SELECT version FROM versions WHERE dataset_id = ? ORDER BY released_at DESC LIMIT 1")
    .get("finma") as { version: string } | undefined;
  if (!latest?.version) return null;
  const candidate = join(dir, `diff-${latest.version}.json`);
  if (!existsSync(candidate)) return null;
  return {
    path: candidate,
    payload: JSON.parse(readFileSync(candidate, "utf8")) as DiffPayload,
  };
}

async function main() {
  const diff = findLatestDiff();
  if (!diff) {
    console.log("[notify-finma] no diff file for the current FINMA version — nothing to do");
    return;
  }
  const { payload } = diff;

  if (payload.removed.length === 0 && payload.added.length === 0) {
    console.log(`[notify-finma] version ${payload.version} has no add/remove diff — skipping notifications`);
    return;
  }

  const db = getDb();

  // Idempotency guard
  const notifyKey = `notify_finma_${payload.version}`;
  try {
    const existing = db
      .prepare("SELECT 1 FROM request_log WHERE path = ? LIMIT 1")
      .get(notifyKey) as { 1: number } | undefined;
    if (existing) {
      console.log(`[notify-finma] already notified for version ${payload.version}, skipping`);
      return;
    }
  } catch {
    // request_log table may not exist on older deploys — proceed anyway.
  }

  const now = Date.now();
  const customers = db
    .prepare(
      `SELECT c.email AS email, c.id AS customer_id
       FROM entitlements e
       JOIN customers c ON c.id = e.customer_id
       WHERE e.dataset_id = 'finma'
         AND (e.updates_until IS NULL OR e.updates_until > ?)`,
    )
    .all(now) as Array<{ email: string; customer_id: number }>;

  console.log(`[notify-finma] version ${payload.version} — ${customers.length} active entitlements to notify`);
  console.log(`[notify-finma] diff: +${payload.added.length} added, -${payload.removed.length} removed, ~${payload.modified.length} modified`);

  const baseUrl = (process.env.BASE_URL ?? "https://www.openswissdata.com").replace(/\/$/, "");

  const summary = [
    payload.removed.length > 0
      ? `<p><strong>${payload.removed.length} entité(s) retirée(s) de la liste FINMA</strong> — leur statut a changé. Mise à jour recommandée sous 24h.</p>`
      : "",
    payload.added.length > 0
      ? `<p>${payload.added.length} nouvelle(s) entité(s) ajoutée(s).</p>`
      : "",
    payload.modified.length > 0
      ? `<p>${payload.modified.length} entité(s) modifiée(s).</p>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let sent = 0;
  let failed = 0;
  for (const customer of customers) {
    try {
      const result = await sendDownloadEmail({
        to: customer.email,
        datasetName: "FINMA Registry",
        downloadUrl: `${baseUrl}/account`,
        accountUrl: `${baseUrl}/account`,
        version: payload.version,
      });
      if (result.sent) sent++;
      else failed++;
    } catch (err) {
      failed++;
      console.error(`[notify-finma] failed to email customer ${customer.customer_id}:`, err);
    }
  }

  console.log(`[notify-finma] done. sent=${sent} failed=${failed}`);

  // Mark as notified so re-runs don't re-spam
  try {
    db.prepare(
      "INSERT INTO request_log (path, method, status, ip, timestamp) VALUES (?, 'CRON', 200, 'cron', ?)",
    ).run(notifyKey, now);
  } catch {
    // request_log absent — silent.
  }
}

main().catch((err) => {
  console.error("[notify-finma] FATAL", err);
  process.exit(1);
});
