import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(path?: string): Database.Database {
  const dbPath = path ?? process.env.DATABASE_PATH ?? "./data/openswissdata.sqlite";
  if (_db) return _db;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
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
