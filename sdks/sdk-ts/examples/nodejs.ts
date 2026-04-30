/**
 * Node.js example — exercise every dataset surface.
 *
 * Run with:
 *   OPENSWISSDATA_API_KEY=your-token npx tsx examples/nodejs.ts
 *
 * Without the env var the client runs anonymously (free tier, ~100 req/day).
 */

import { Client, RateLimitError } from "../src/index.js";

async function main() {
  const client = new Client({
    apiKey: process.env.OPENSWISSDATA_API_KEY,
  });

  // 1. TARES — exact lookup of a Swiss customs tariff
  console.log("=== TARES lookup ===");
  const tariff = await client.tares.lookup({ hs8: "84620010", lang: "fr" });
  console.log(`HS8 ${tariff.hs8} — ${tariff.designation}`);
  console.log(`MFN duty: ${tariff.duty_mfn.value ?? "n/a"} ${tariff.duty_mfn.unit ?? ""}`);
  console.log(`(${tariff.disclaimer.slice(0, 80)}...)`);

  // 2. TARES — semantic search
  console.log("\n=== TARES semantic search ===");
  const hits = await client.tares.search({ query: "couteau de cuisine", top_k: 3 });
  for (const h of hits.hits) {
    console.log(`  ${h.score.toFixed(2)}  HS ${h.hs_code}  ${h.description}`);
  }

  // 3. Classifications — crosswalk NACE 2.0 → NOGA 2025
  console.log("\n=== Cross-walk ===");
  const cw = await client.classifications.crossWalk({
    code: "62.01",
    source: "NACE_2.0",
    target: "NOGA_2025",
  });
  for (const m of cw.mappings) {
    console.log(`  ${cw.source_code} → ${m.target_code} (${m.mapping_type})`);
  }

  // 4. Classifications — free-text classification
  console.log("\n=== Classify free text ===");
  const cls = await client.classifications.classifyText({
    text: "vente de café en grain et torréfaction",
    top_k: 3,
  });
  for (const h of cls.hits) {
    console.log(`  ${h.score.toFixed(2)}  ${h.code}  ${h.label_fr}`);
  }

  // 5. FINMA — fuzzy search
  console.log("\n=== FINMA fuzzy search ===");
  const fr = await client.finma.search({ name: "Cred Suisse", top_k: 3 });
  for (const h of fr.hits) {
    console.log(`  ${h.score.toFixed(2)}  ${h.name}  (${h.licence_type})`);
  }

  // 6. Rate-limit telemetry
  if (client.lastRateLimit.remaining !== undefined) {
    console.log(
      `\nRemaining requests: ${client.lastRateLimit.remaining}/${client.lastRateLimit.limit}`,
    );
  }
}

main().catch((e) => {
  if (e instanceof RateLimitError) {
    console.error(`Rate limited — retry after ${e.retryAfterSeconds ?? "?"}s`);
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
