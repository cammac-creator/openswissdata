import type Database from "better-sqlite3";

const REQUEST_LOG_RETENTION_MS = 30 * 24 * 3600 * 1000;
// Aligned with /legal/privacy retention claim.
const EVENTS_RETENTION_MS = 180 * 24 * 3600 * 1000;

export type CleanupEntry = {
  name: string;
  deleted: number;
  skipped?: string;
};

export type CleanupResult = {
  entries: CleanupEntry[];
  totalDeleted: number;
};

export function runCleanup(db: Database.Database): CleanupResult {
  const now = Date.now();
  const entries: CleanupEntry[] = [];
  let totalDeleted = 0;

  const ttlTables: Array<{ name: string; sql: string }> = [
    { name: "magic_links", sql: "DELETE FROM magic_links WHERE expires_at < ?" },
    { name: "sessions", sql: "DELETE FROM sessions WHERE expires_at < ?" },
    { name: "download_tokens", sql: "DELETE FROM download_tokens WHERE expires_at < ?" },
    { name: "mcp_oauth_codes", sql: "DELETE FROM mcp_oauth_codes WHERE expires_at < ?" },
  ];

  for (const t of ttlTables) {
    try {
      const result = db.prepare(t.sql).run(now);
      entries.push({ name: t.name, deleted: result.changes });
      totalDeleted += result.changes;
    } catch (err) {
      entries.push({
        name: t.name,
        deleted: 0,
        skipped: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const cutoff = now - REQUEST_LOG_RETENTION_MS;
    const result = db.prepare("DELETE FROM request_log WHERE timestamp < ?").run(cutoff);
    entries.push({ name: "request_log", deleted: result.changes });
    totalDeleted += result.changes;
  } catch (err) {
    entries.push({
      name: "request_log",
      deleted: 0,
      skipped: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const cutoff = now - EVENTS_RETENTION_MS;
    const result = db.prepare("DELETE FROM events WHERE ts < ?").run(cutoff);
    entries.push({ name: "events", deleted: result.changes });
    totalDeleted += result.changes;
  } catch (err) {
    entries.push({
      name: "events",
      deleted: 0,
      skipped: err instanceof Error ? err.message : String(err),
    });
  }

  // Même durée que les traces techniques publiées : aucun historique de téléchargement illimité.
  const activity = db.prepare("DELETE FROM download_activity WHERE created_at < ?").run(now - EVENTS_RETENTION_MS);
  entries.push({ name: "download_activity", deleted: activity.changes });
  totalDeleted += activity.changes;

  // L’identifiant du mail n’a plus d’utilité de support après la même fenêtre ; la preuve d’acceptation reste datée.
  const messages = db.prepare("UPDATE order_deliveries SET provider_message_id=NULL WHERE provider_message_id IS NOT NULL AND COALESCE(sent_at,created_at) < ?")
    .run(now - EVENTS_RETENTION_MS);
  entries.push({ name: "delivery_message_references", deleted: messages.changes });
  totalDeleted += messages.changes;

  return { entries, totalDeleted };
}
