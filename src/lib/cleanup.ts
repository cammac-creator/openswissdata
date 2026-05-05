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

  return { entries, totalDeleted };
}
