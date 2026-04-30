import { mkdirSync, existsSync, statSync, createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
// tsx (CJS interop) doesn't honour package.json exports for nace-codes,
// so we point to the built ESM file directly.
import { NACE } from "../../node_modules/nace-codes/dist/nace.js";
import type { NomenclatureRow, NomenclatureLevel, NomenclatureScheme, CrossWalkRow } from "./types.js";

/**
 * Real ingestion of Classifications from authoritative open sources (v2 — 2026-04-29):
 *
 * - NACE Rev 2     → from npm `nace-codes` (Eurostat-derived, MIT license, 24 EU languages)
 * - NACE Rev 2.1   → from EU Vocabularies SKOS/XKOS RDF (publications.europa.eu, 24 EU languages,
 *                    incl. official `closeMatch` mappings to NACE Rev 2)
 * - NOGA 2008      → from i14y.admin.ch (Swiss interoperability platform, EN/DE/FR/IT, 1790 codes)
 * - NOGA 2025      → from i14y.admin.ch (EN/DE/FR/IT, 1845 codes incl. 6-digit CH-specific subclasses)
 * - ISIC Rev 4     → from UN Statistics CSV (EN + FR + ES) at unstats.un.org
 *
 * Cross-walks:
 * - NOGA_2008 ↔ NACE_2.0 : identity (BFS methodology, identical at section/division/group/class
 *   levels; the 5/6-digit CH-specific subclasses don't exist in NACE).
 * - NOGA_2025 ↔ NACE_2.1 : identity (BFS confirms NOGA 2025 is NACE 2.1 + CH 5/6-digit).
 * - NACE_2.0 ↔ NACE_2.1 : 1589 official `closeMatch` SKOS triples extracted from the NACE 2.1
 *   RDF, treated as `exact` mapping_type.
 * - NACE_2.x ↔ ISIC_4   : derived per-class. NACE Rev 2 was built directly on ISIC Rev 4, so
 *   the first 4 digits of NACE often match the 4-digit ISIC class.
 * - NOGA_2008 ↔ NOGA_2025 : derived via the chain NOGA_2008 → NACE_2.0 → NACE_2.1 → NOGA_2025.
 */

const ISIC_CSV_BY_LANG: Record<"en" | "fr" | "es", string> = {
  en: "https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_english_structure.Txt",
  fr: "https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_French_structure.Txt",
  es: "https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_Spanish_structure.Txt",
};

// EU Vocabularies — official SKOS/XKOS RDF distribution of NACE Rev 2.1
// Listed at https://data.europa.eu/data/datasets/nace2-1
const NACE_2_1_RDF_URL =
  "https://op.europa.eu/o/opportal-service/euvoc-download-handler?cellarURI=http%3A%2F%2Fpublications.europa.eu%2Fresource%2Fcellar%2Fbeb2efec-da9a-11ed-a05c-01aa75ed71a1.0001.02%2FDOC_1&fileName=ESTAT-NACE2.1.rdf";

// i14y.admin.ch — Swiss interoperability platform; concept IDs are stable.
// Catalog: https://www.i14y.admin.ch/de/catalog/datasets/HCL_NOGA
const NOGA_2025_CONCEPT_ID = "001bfaa8-fa57-4d66-acfd-c795d67fcf80"; // identifier=nogaCode v2.0.1
const NOGA_2008_CONCEPT_ID = "08dc481b-2add-1232-b5fe-b1fae7a1ac02"; // identifier=nogaCode v1.0.0
const I14Y_API = "https://api.i14y.admin.ch/api/public/v1";

async function downloadIfStale(url: string, path: string, maxAgeHours = 24 * 7): Promise<void> {
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < maxAgeHours * 3600 * 1000) return;
  console.log(`[classifications] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(path));
}

function levelFromCode(code: string, level?: number): NomenclatureLevel {
  if (level !== undefined) {
    if (level === 1) return "section";
    if (level === 2) return "division";
    if (level === 3) return "group";
    if (level === 4) return "class";
    return "subclass";
  }
  const clean = code.replace(/\./g, "");
  if (/^[A-Z]$/.test(clean)) return "section";
  switch (clean.length) {
    case 2: return "division";
    case 3: return "group";
    case 4: return "class";
    default: return "subclass";
  }
}

function parentFromCode(code: string): string | null {
  const clean = code.replace(/\./g, "");
  if (clean.length <= 1) return null;
  return clean.slice(0, -1);
}

/**
 * Pull all NACE Rev 2 codes from nace-codes and convert to NomenclatureRow[].
 * The library exposes 1047 codes across all 5 levels with descriptions in
 * 24 EU official languages; we keep the four we publish (EN/FR/DE/IT) plus
 * source label_en for completeness.
 */
export function loadNaceFromPackage(): NomenclatureRow[] {
  const nace = new NACE();
  const all = nace.getAllCodes();
  const out: NomenclatureRow[] = [];
  for (const c of all) {
    const code = c.code.replace(/\./g, "");
    const desc = c.description as Record<string, string | undefined>;
    out.push({
      scheme: "NACE_2.0",
      code,
      level: levelFromCode(code, c.level),
      parent: c.parent ? c.parent.replace(/\./g, "") : parentFromCode(code),
      label_en: desc.en,
      label_fr: desc.fr,
      label_de: desc.de,
      label_it: desc.it,
    });
  }
  return out;
}

/**
 * Parse the UN ISIC Rev 4 plain CSV. Each row : "code","description". Hierarchy
 * is recovered by string length (or letter for sections). CSV is double-quoted,
 * encoded latin-1 for FR/ES (the UN file uses Windows-1252, not UTF-8).
 */
export function parseIsicCsvLatin(path: string, lang: "en" | "fr" | "es"): NomenclatureRow[] {
  const buf = readFileSync(path);
  const decoder = new TextDecoder(lang === "en" ? "utf-8" : "windows-1252");
  const content = decoder.decode(buf);
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const out: NomenclatureRow[] = [];
  const labelKey = lang === "en" ? "label_en" : lang === "fr" ? "label_fr" : "label_es";
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], ",");
    if (cells.length < 2) continue;
    const code = cells[0].replace(/\./g, "").trim();
    const description = cells[1].trim();
    if (!code) continue;
    const row: NomenclatureRow = {
      scheme: "ISIC_4",
      code,
      level: levelFromCode(code),
      parent: parentFromCode(code),
    };
    (row as Record<string, unknown>)[labelKey] = description;
    out.push(row);
  }
  return out;
}

/**
 * Merge per-language ISIC arrays into a single NomenclatureRow[] keyed by code.
 */
export function mergeIsicByLang(perLang: NomenclatureRow[][]): NomenclatureRow[] {
  const byCode = new Map<string, NomenclatureRow>();
  for (const arr of perLang) {
    for (const r of arr) {
      const cur = byCode.get(r.code);
      if (cur) {
        for (const k of ["label_en", "label_fr", "label_de", "label_it"] as const) {
          if (!cur[k] && r[k]) cur[k] = r[k];
        }
        const rec = r as Record<string, unknown>;
        if (rec.label_es && !(cur as Record<string, unknown>).label_es) {
          (cur as Record<string, unknown>).label_es = rec.label_es;
        }
      } else {
        byCode.set(r.code, { ...r });
      }
    }
  }
  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
}

function parseCsvLine(line: string, sep = ","): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (line[i + 1] === "\"") { cur += "\""; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === "\"") inQuotes = true;
      else if (ch === sep) { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/* ------------------------------------------------------------------ *
 * NOGA 2025 + NOGA 2008 — i14y.admin.ch JSON ingestion
 * ------------------------------------------------------------------ */

interface I14yCodeListEntry {
  code: string;
  parentCode: string | null;
  name: { de?: string; fr?: string; it?: string; en?: string };
}

interface I14yConceptResponse {
  data: { codeListEntries: I14yCodeListEntry[] };
}

async function fetchI14yConcept(conceptId: string, cachePath: string): Promise<I14yCodeListEntry[]> {
  if (!existsSync(cachePath) || Date.now() - statSync(cachePath).mtimeMs > 7 * 24 * 3600 * 1000) {
    const url = `${I14Y_API}/concepts/${conceptId}?includeCodeListEntries=true`;
    console.log(`[classifications] downloading ${url}`);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`i14y fetch failed for concept ${conceptId}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(cachePath, buf);
  }
  const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as I14yConceptResponse;
  return parsed.data?.codeListEntries ?? [];
}

function nogaLevelFromCode(code: string): NomenclatureLevel {
  // NOGA hierarchy: A (section, len 1), 01 (division, 2), 011 (group, 3), 0111 (class, 4),
  // 011100 (CH subclass, 6 — there is no 5-digit level in the BFS data).
  if (/^[A-Z]$/.test(code)) return "section";
  switch (code.length) {
    case 2: return "division";
    case 3: return "group";
    case 4: return "class";
    case 5: return "subclass";
    case 6: return "subclass";
    default: return "subclass";
  }
}

function i14yToNomenclatureRows(
  entries: I14yCodeListEntry[],
  scheme: NomenclatureScheme,
): NomenclatureRow[] {
  return entries
    .filter(e => typeof e.code === "string" && e.code.length > 0)
    .map(e => ({
      scheme,
      code: e.code,
      level: nogaLevelFromCode(e.code),
      parent: e.parentCode ?? null,
      label_de: e.name?.de,
      label_fr: e.name?.fr,
      label_it: e.name?.it,
      label_en: e.name?.en,
    }));
}

export async function loadNoga2025FromI14y(cacheDir: string): Promise<NomenclatureRow[]> {
  const path = join(cacheDir, "noga_2025_i14y.json");
  const entries = await fetchI14yConcept(NOGA_2025_CONCEPT_ID, path);
  return i14yToNomenclatureRows(entries, "NOGA_2025");
}

export async function loadNoga2008FromI14y(cacheDir: string): Promise<NomenclatureRow[]> {
  const path = join(cacheDir, "noga_2008_i14y.json");
  const entries = await fetchI14yConcept(NOGA_2008_CONCEPT_ID, path);
  return i14yToNomenclatureRows(entries, "NOGA_2008");
}

/* ------------------------------------------------------------------ *
 * NACE Rev 2.1 — EU Vocabularies SKOS/XKOS RDF ingestion
 * ------------------------------------------------------------------ */

interface Nace21RdfResult {
  rows: NomenclatureRow[];
  /** Mapping NACE 2.1 code → list of NACE 2.0 codes (skos:closeMatch in the RDF). */
  closeMatchToNace2: Map<string, string[]>;
}

/**
 * Parse the EU Vocabularies NACE 2.1 RDF (SKOS Concept Scheme).
 *
 * The file is a flat sequence of <rdf:Description rdf:about="…/nace2.1/{code}"> blocks.
 * For each block we extract:
 *   - identifier (dc:identifier or dcterms:identifier)
 *   - prefLabel @en/@fr/@de/@it (skos:prefLabel)
 *   - broader code (skos:broader → ".../nace2.1/{parent}")
 *   - closeMatch to NACE 2 (skos:closeMatch → ".../nace2/{code}") for cross-walk building
 *
 * We tolerate XML attribute order and namespace declaration variations.
 */
export function parseNace21Rdf(path: string): Nace21RdfResult {
  const xml = readFileSync(path, "utf8");
  const rows: NomenclatureRow[] = [];
  const closeMatchToNace2 = new Map<string, string[]>();
  // Match each <rdf:Description rdf:about="…/nace2.1/{code}">…</rdf:Description> block.
  const blockRe = /<rdf:Description\s+rdf:about="([^"]+)">([\s\S]*?)<\/rdf:Description>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const about = m[1];
    const body = m[2];
    // Only NACE 2.1 concept entities (skip rdf:type metadata blocks etc.)
    const codeMatch = about.match(/\/nace2\.1\/([A-Z0-9]+)$/);
    if (!codeMatch) continue;
    const code = codeMatch[1];

    // Skip if it's not a Concept (just safety; in this file, every nace2.1/ entry is a Concept).
    if (!/skos\/core#Concept/.test(body)) continue;

    // prefLabel per language
    const labelByLang: Record<string, string> = {};
    const prefRe = /<prefLabel[^>]*xml:lang="([^"]+)"[^>]*>([^<]*)<\/prefLabel>/g;
    let pm: RegExpExecArray | null;
    while ((pm = prefRe.exec(body)) !== null) {
      const lang = pm[1].toLowerCase();
      labelByLang[lang] = decodeXmlEntities(pm[2]);
    }
    // broader → parent
    let parent: string | null = null;
    const broaderRe = /<broader[^>]*rdf:resource="([^"]+)"\s*\/>/;
    const bm = body.match(broaderRe);
    if (bm) {
      const bMatch = bm[1].match(/\/nace2\.1\/([A-Z0-9]+)$/);
      if (bMatch) parent = bMatch[1];
    }
    // closeMatch → NACE 2 cross-walk
    const cmRe = /<closeMatch[^>]*rdf:resource="([^"]+)"\s*\/>/g;
    const matches: string[] = [];
    let cmm: RegExpExecArray | null;
    while ((cmm = cmRe.exec(body)) !== null) {
      const t = cmm[1].match(/\/nace2\/([A-Z0-9]+)$/);
      if (t) matches.push(t[1]);
    }
    if (matches.length > 0) closeMatchToNace2.set(code, matches);

    rows.push({
      scheme: "NACE_2.1",
      code,
      level: levelFromCode(code),
      parent,
      label_en: labelByLang["en"],
      label_fr: labelByLang["fr"],
      label_de: labelByLang["de"],
      label_it: labelByLang["it"],
    });
  }
  // Sort by code for determinism in bundles.
  rows.sort((a, b) => a.code.localeCompare(b.code));
  return { rows, closeMatchToNace2 };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

/* ------------------------------------------------------------------ *
 * Cross-walks
 * ------------------------------------------------------------------ */

/**
 * Build cross-walks across all 5 schemes anchored on NOGA 2025 codes (one row per
 * NOGA 2025 entity above section level — sections are letters and don't carry
 * mappings).
 *
 * Mapping strategy:
 *
 *  - NOGA_2025 ↔ NACE_2.1  : identity at section/division/group/class. CH-specific
 *    5/6-digit subclasses do not have a NACE 2.1 counterpart → nace_2_1 = null.
 *  - NACE_2.1 ↔ NACE_2.0   : official `skos:closeMatch` triples extracted from the
 *    Eurostat RDF (1589 mappings). When present, mapping_type starts as `exact`.
 *  - NACE_2.0 ↔ NOGA_2008  : identity at all levels (BFS methodology).
 *  - NACE_2.x ↔ ISIC_4     : exact when the 4-digit code matches in both, partial otherwise.
 *  - NOGA_2008 ↔ NOGA_2025 : transitive via the NOGA_2008 → NACE_2.0 → NACE_2.1 → NOGA_2025
 *    chain. mapping_type degrades to `partial` if any step is partial / mismatched.
 *
 * If a NOGA 2025 code has no NACE 2.0 closeMatch, we fall back to identity (it
 * means the code is unchanged across the revision — typical for the majority).
 */
export function buildRealCrossWalks(
  rows: NomenclatureRow[],
  closeMatchNace21toNace2: Map<string, string[]>,
): CrossWalkRow[] {
  // Build per-scheme code sets for fast presence lookup.
  const set = (scheme: NomenclatureScheme) =>
    new Set(rows.filter(r => r.scheme === scheme).map(r => r.code));
  const nace20Set = set("NACE_2.0");
  const nace21Set = set("NACE_2.1");
  const noga2008Set = set("NOGA_2008");
  const isicSet = set("ISIC_4");

  // NOGA 2025 anchor — keep all levels except section (matches existing scope).
  const noga2025Anchors = rows.filter(r => r.scheme === "NOGA_2025" && r.level !== "section");

  const out: CrossWalkRow[] = [];
  for (const row of noga2025Anchors) {
    const code = row.code;
    // NACE 2.1 mirror exists when the same code is in NACE 2.1 (true at section/div/group/class).
    const nace21 = nace21Set.has(code) ? code : null;

    // NACE 2.0 candidates from the official closeMatch table (only at granularity ≤ class).
    const closeList = nace21 ? closeMatchNace21toNace2.get(nace21) ?? [] : [];
    const nace20Candidates: string[] = closeList.length
      ? closeList.filter(c => nace20Set.has(c))
      : nace20Set.has(code)
        ? [code] // identity fallback when no explicit mapping = no change between revisions
        : [];

    // ISIC 4 — match at class level if both classifications share the code.
    const isic = isicSet.has(code) ? code : null;

    if (nace20Candidates.length === 0) {
      // No NACE 2.0 path → emit a row anyway with NOGA_2025 only and best-effort ISIC.
      out.push({
        noga_2008: null,
        noga_2025: code,
        nace_2_0: null,
        nace_2_1: nace21,
        isic_4: isic,
        mapping_type: nace21 ? "partial" : "derived",
        notes: nace21
          ? "no NACE 2.0 closeMatch — likely a new code introduced in NACE 2.1"
          : "CH-specific subclass — no NACE counterpart",
      });
      continue;
    }

    for (const n20 of nace20Candidates) {
      const noga2008 = noga2008Set.has(n20) ? n20 : null;
      // mapping_type heuristic:
      // - exact iff there's an official closeMatch AND ISIC class matches
      // - partial otherwise (one or more bridges missing / approximate)
      const closeMatched = closeList.includes(n20);
      const exact = closeMatched && isic !== null;
      const mappingType: CrossWalkRow["mapping_type"] = exact
        ? "exact"
        : closeMatched
          ? "partial"
          : "derived"; // identity fallback
      out.push({
        noga_2008: noga2008,
        noga_2025: code,
        nace_2_0: n20,
        nace_2_1: nace21,
        isic_4: isic,
        mapping_type: mappingType,
        notes: closeMatched
          ? undefined
          : "derived by code identity (no explicit closeMatch in source RDF)",
      });
    }
  }
  return out;
}

/**
 * Top-level orchestrator: download what we need, load all 5 schemes from real
 * sources, build cross-walks. Returns everything ready for `buildBundle`.
 */
export async function ingestRealClassifications(opts: { cacheDir: string }): Promise<{
  rows: NomenclatureRow[];
  crossWalks: CrossWalkRow[];
  stats: {
    nace_2_0: number;
    nace_2_1: number;
    noga_2008: number;
    noga_2025: number;
    isic: number;
    crosswalks: number;
  };
}> {
  if (!existsSync(opts.cacheDir)) mkdirSync(opts.cacheDir, { recursive: true });

  // 1. NACE Rev 2 from package
  const nace20 = loadNaceFromPackage();

  // 2. NACE Rev 2.1 from EU Vocabularies SKOS RDF
  const nace21RdfPath = join(opts.cacheDir, "ESTAT-NACE2.1.rdf");
  await downloadIfStale(NACE_2_1_RDF_URL, nace21RdfPath);
  const nace21Result = parseNace21Rdf(nace21RdfPath);

  // 3. NOGA 2008 + NOGA 2025 from i14y.admin.ch (Swiss interoperability platform)
  const noga2008 = await loadNoga2008FromI14y(opts.cacheDir);
  const noga2025 = await loadNoga2025FromI14y(opts.cacheDir);

  // 4. ISIC Rev 4 from UN, three languages
  const perLang: NomenclatureRow[][] = [];
  for (const lang of ["en", "fr", "es"] as const) {
    const path = join(opts.cacheDir, `isic_rev4_${lang}.txt`);
    await downloadIfStale(ISIC_CSV_BY_LANG[lang], path);
    perLang.push(parseIsicCsvLatin(path, lang));
  }
  const isic = mergeIsicByLang(perLang);

  // 5. Combine all rows
  const rows = [...noga2008, ...noga2025, ...nace20, ...nace21Result.rows, ...isic];

  // 6. Cross-walks (using NACE 2.1 closeMatch triples extracted above)
  const crossWalks = buildRealCrossWalks(rows, nace21Result.closeMatchToNace2);

  return {
    rows,
    crossWalks,
    stats: {
      nace_2_0: nace20.length,
      nace_2_1: nace21Result.rows.length,
      noga_2008: noga2008.length,
      noga_2025: noga2025.length,
      isic: isic.length,
      crosswalks: crossWalks.length,
    },
  };
}
