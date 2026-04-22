import { getDb } from "../lib/db.js";

interface DatasetSeed {
  id: string;
  name: string;
  slug: string;
  price_chf: number;
  stripe_price_id_env: string;
  stripe_updates_price_id_env: string | null;
}

const DATASETS: DatasetSeed[] = [
  {
    id: "tares",
    name: "TARES — Swiss Customs Tariff",
    slug: "tares",
    price_chf: 29900,
    stripe_price_id_env: "STRIPE_PRICE_TARES",
    stripe_updates_price_id_env: "STRIPE_PRICE_TARES_UPDATES",
  },
  {
    id: "classifications",
    name: "Swiss Economic Classifications Bundle",
    slug: "classifications",
    price_chf: 39900,
    stripe_price_id_env: "STRIPE_PRICE_CLASSIFICATIONS",
    stripe_updates_price_id_env: "STRIPE_PRICE_CLASSIFICATIONS_UPDATES",
  },
  {
    id: "finma",
    name: "FINMA Registry — Unified",
    slug: "finma",
    price_chf: 29900,
    stripe_price_id_env: "STRIPE_PRICE_FINMA",
    stripe_updates_price_id_env: "STRIPE_PRICE_FINMA_UPDATES",
  },
];

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === "" || v.startsWith("price_test_xxx") || v === "xxx") {
    throw new Error(
      `Missing or placeholder env var: ${key}. Set it in .env and Railway before seeding.`
    );
  }
  return v.trim();
}

export interface SeedResult {
  inserted: string[];
  updated: string[];
}

export function seedDatasets(): SeedResult {
  const db = getDb();
  const now = Date.now();
  const result: SeedResult = { inserted: [], updated: [] };

  const existing = new Set(
    (db.prepare("SELECT id FROM datasets").all() as { id: string }[]).map(
      (r) => r.id
    )
  );

  const stmt = db.prepare(`
    INSERT INTO datasets (id, name, slug, price_chf, stripe_price_id, stripe_updates_price_id, created_at)
    VALUES (@id, @name, @slug, @price_chf, @stripe_price_id, @stripe_updates_price_id, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      price_chf = excluded.price_chf,
      stripe_price_id = excluded.stripe_price_id,
      stripe_updates_price_id = excluded.stripe_updates_price_id
  `);

  for (const d of DATASETS) {
    const stripe_price_id = requireEnv(d.stripe_price_id_env);
    const stripe_updates_price_id = d.stripe_updates_price_id_env
      ? requireEnv(d.stripe_updates_price_id_env)
      : null;
    stmt.run({
      id: d.id,
      name: d.name,
      slug: d.slug,
      price_chf: d.price_chf,
      stripe_price_id,
      stripe_updates_price_id,
      created_at: now,
    });
    if (existing.has(d.id)) result.updated.push(d.id);
    else result.inserted.push(d.id);
  }

  return result;
}

function main() {
  const r = seedDatasets();
  if (r.inserted.length) console.log(`inserted: ${r.inserted.join(", ")}`);
  if (r.updated.length) console.log(`updated: ${r.updated.join(", ")}`);
  if (!r.inserted.length && !r.updated.length) console.log("no changes");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
