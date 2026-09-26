import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrateOrderRights } from "./order-rights.js";
import { resolveDatabasePath } from './data-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function currentDatabasePath(): string { return _db?.name ?? resolveDatabasePath(); }

export function getDb(path?: string, options: { fileMustExist?: boolean } = {}): Database.Database {
  const dbPath = resolveDatabasePath(path);
  if (_db) return _db;

  const dir = dirname(dbPath);
  if (!options.fileMustExist && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, options);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = join(__dirname, "..", "db", "schema.sql");
  const schema = readFileSync(schemaPath, "utf8");
  db.exec(schema);

  // Idempotent column migration. schema.sql uses CREATE TABLE IF NOT EXISTS,
  // which does NOT alter a pre-existing table — so a column added after the
  // table first shipped (mcp_clients.stripe_subscription_id) is absent on older
  // databases. Ensure it before any code SELECT/INSERTs it (e.g. /oauth/register
  // and the Stripe subscription webhook), then build its index. The 'business'
  // tier's CHECK-constraint widening cannot be done with ALTER — it lives in
  // src/db/migrations/003 and must be applied manually before selling Business.
  ensureColumn(db, "mcp_clients", "stripe_subscription_id", "TEXT");
  // Buyer language for transactional emails — added after `customers` first
  // shipped, so backfill on older DBs (constant DEFAULT makes the ALTER legal).
  ensureColumn(db, "customers", "locale", "TEXT NOT NULL DEFAULT 'fr'");
  ensureColumn(db, "orders", "refunded_chf", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "orders", "dispute_status", "TEXT");
  ensureColumn(db, "orders", "financial_checked_at", "INTEGER");
  ensureColumn(db, "order_deliveries", "provider_message_id", "TEXT");
  // Une trace ancienne ne reçoit pas rétroactivement une origine serveur supposée.
  ensureColumn(db, "events", "origin", "TEXT NOT NULL DEFAULT 'legacy' CHECK (origin IN ('legacy','server','client'))");
  ensureColumn(db, "download_tokens", "activity_id", "INTEGER REFERENCES download_activity(id) ON DELETE SET NULL");
  db.exec("CREATE INDEX IF NOT EXISTS idx_download_tokens_activity ON download_tokens(activity_id)");
  migrateOrderRights(db);
  // UNIQUE (partial) so a given Stripe subscription can back at most one client.
  // Partial → multiple NULLs (free/registered clients) remain allowed. Turns a
  // concurrent double-provision into a catchable constraint error instead of
  // two paid clients for one subscription.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_clients_subscription ON mcp_clients(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL",
  );

  _db = db;
  return db;
}

/** Add a column to an existing table only if it isn't already present. */
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  decl: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
