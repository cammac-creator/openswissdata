import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import type { CrossWalkRow, NomenclatureRow } from "./types.js";

interface BridgeEntry {
  from: string;
  to: string;
  type: "exact" | "partial" | "aggregated" | "derived";
}

interface BridgeFiles {
  nace20to21Path: string;
  nace21toIsic4Path: string;
}

function parseBridge(path: string, fromCol: string, toCol: string): BridgeEntry[] {
  const raw = readFileSync(path, "utf8");
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const entries: BridgeEntry[] = [];
  for (const r of records) {
    const from = (r[fromCol] ?? "").replace(/\./g, "").trim();
    const to = (r[toCol] ?? "").replace(/\./g, "").trim();
    const typeRaw = (r.Type ?? "exact").trim().toLowerCase();
    const type: BridgeEntry["type"] =
      typeRaw === "partial"
        ? "partial"
        : typeRaw === "aggregated"
          ? "aggregated"
          : typeRaw === "derived"
            ? "derived"
            : "exact";
    if (from && to) entries.push({ from, to, type });
  }
  return entries;
}

/**
 * Build 5-way cross-walks anchored on NOGA_2025 classes.
 *
 * Principle:
 * - NOGA_2025.code === NACE_2.1.code (at class level and below)
 * - NOGA_2008.code === NACE_2.0.code
 * - Bridge NACE_2.0 ↔ NACE_2.1 is explicit (Eurostat)
 * - Bridge NACE_2.1 ↔ ISIC_4 is explicit (UN Stats)
 *
 * For each NOGA_2025 class code, emit a row with:
 * - noga_2025 = code
 * - nace_2_1 = code (identity)
 * - nace_2_0 = lookup reverse bridge NACE_2.0→2.1 where to===code
 * - noga_2008 = nace_2_0 (identity)
 * - isic_4 = lookup bridge NACE_2.1→ISIC_4 where from===code
 * - mapping_type = worst-case type across the chain
 *
 * Only rows at level "class" or below are emitted (mappings are only authoritative at class granularity).
 */
export function buildCrossWalks(allRows: NomenclatureRow[], opts: BridgeFiles): CrossWalkRow[] {
  const bridge20to21 = parseBridge(opts.nace20to21Path, "NACE_2_0", "NACE_2_1");
  const bridge21toIsic = parseBridge(opts.nace21toIsic4Path, "NACE_2_1", "ISIC_4");

  const reverse20to21 = new Map<string, Array<{ code: string; type: BridgeEntry["type"] }>>();
  for (const b of bridge20to21) {
    const list = reverse20to21.get(b.to) ?? [];
    list.push({ code: b.from, type: b.type });
    reverse20to21.set(b.to, list);
  }
  const to21toIsic = new Map<string, Array<{ code: string; type: BridgeEntry["type"] }>>();
  for (const b of bridge21toIsic) {
    const list = to21toIsic.get(b.from) ?? [];
    list.push({ code: b.to, type: b.type });
    to21toIsic.set(b.from, list);
  }

  const noga25Classes = allRows.filter(
    r => r.scheme === "NOGA_2025" && (r.level === "class" || r.level === "subclass"),
  );
  const out: CrossWalkRow[] = [];

  for (const row of noga25Classes) {
    const nace21 = row.code;
    const nace20Matches = reverse20to21.get(nace21) ?? [];
    const isicMatches = to21toIsic.get(nace21) ?? [];

    // Emit one row per combination (or a single row if no bridge match)
    if (nace20Matches.length === 0 && isicMatches.length === 0) {
      out.push({
        noga_2008: null,
        noga_2025: row.code,
        nace_2_0: null,
        nace_2_1: nace21,
        isic_4: null,
        mapping_type: "partial",
        notes: "no bridge match in fixtures",
      });
      continue;
    }

    const nace20List =
      nace20Matches.length > 0 ? nace20Matches : [{ code: "", type: "partial" as const }];
    const isicList =
      isicMatches.length > 0 ? isicMatches : [{ code: "", type: "partial" as const }];

    for (const n20 of nace20List) {
      for (const isic of isicList) {
        const chainType: CrossWalkRow["mapping_type"] =
          n20.type === "exact" && isic.type === "exact" ? "exact" : "partial";
        out.push({
          noga_2008: n20.code || null,
          noga_2025: row.code,
          nace_2_0: n20.code || null,
          nace_2_1: nace21,
          isic_4: isic.code || null,
          mapping_type: chainType,
        });
      }
    }
  }

  return out;
}
