import { mkdirSync, existsSync, statSync, createWriteStream, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
// tsx (CJS interop) doesn't honour package.json exports for nace-codes,
// so we point to the built ESM file directly.
import { NACE } from "../../node_modules/nace-codes/dist/nace.js";
import type { NomenclatureRow, NomenclatureLevel, NomenclatureScheme, CrossWalkRow } from "./types.js";

/**
 * Real ingestion of Classifications from authoritative open sources:
 *
 * - NACE Rev 2 → from npm `nace-codes` (Eurostat-derived, MIT license, 24 EU languages)
 * - NOGA 2008  → identity copy of NACE Rev 2 (NOGA = NACE for the first 4 digits;
 *                CH-specific 5/6-digit subclasses are not yet ingested → annoncé v2)
 * - ISIC Rev 4 → from UN Statistics CSV (EN + FR + ES) at unstats.un.org
 * - NACE Rev 2.1 + NOGA 2025 : not in nace-codes yet → empty in v1, annoncé v2
 *
 * Cross-walk NACE Rev 2 ↔ ISIC Rev 4 : derived per-code at division level
 * (the first 2 digits of NACE = the first 2 digits of ISIC by ISIC-based design).
 * For class-level (4 digits) : exact match when both schemes share the same code.
 */

const ISIC_CSV_BY_LANG: Record<"en" | "fr" | "es", string> = {
  en: "https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_english_structure.Txt",
  fr: "https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_French_structure.Txt",
  es: "https://unstats.un.org/unsd/classifications/Econ/Download/In%20Text/ISIC_Rev_4_Spanish_structure.Txt",
};

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
 * Mirror NACE Rev 2 as NOGA 2008. NOGA is BFS's national extension of NACE;
 * codes at section/division/group/class levels are identical (BFS docs +
 * Eurostat methodology). CH-specific 5/6-digit subclasses are not in this v1.
 */
export function deriveNoga2008FromNace(naceRows: NomenclatureRow[]): NomenclatureRow[] {
  return naceRows.map(r => ({ ...r, scheme: "NOGA_2008" as NomenclatureScheme }));
}

/**
 * Parse the UN ISIC Rev 4 plain CSV. Each row : "code","description". Hierarchy
 * is recovered by string length (or letter for sections). CSV is double-quoted,
 * encoded latin-1 for FR/ES (the UN file uses Windows-1252, not UTF-8).
 */
export function parseIsicCsvLatin(path: string, lang: "en" | "fr" | "es"): NomenclatureRow[] {
  // The UN files use Windows-1252 encoding for non-EN languages → Buffer + iconv-lite would be ideal
  // but we keep deps minimal; Node 20+ supports decoding via TextDecoder('windows-1252').
  const buf = readFileSync(path);
  const decoder = new TextDecoder(lang === "en" ? "utf-8" : "windows-1252");
  const content = decoder.decode(buf);
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  // First line is header "Code","Description"
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
        // capture optional Spanish label too (added beyond the standard 4 langs)
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

/**
 * Build cross-walks for the schemes we currently ship.
 *
 * Scope v1:
 * - NOGA_2008 ↔ NACE_2.0 : identity (same code at all levels, by design)
 * - NACE_2.0 ↔ ISIC_4 : derived per-class. NACE Rev 2 was built directly on
 *   ISIC Rev 4, so the first 4 digits of NACE often match the 4-digit ISIC
 *   class. For divisions/groups the match is exact. We emit a row for each
 *   pair where both codes exist in our snapshots.
 *
 * NOGA_2025 + NACE_2.1 : not yet in our sources → emitted as `null` columns.
 */
export function buildRealCrossWalks(rows: NomenclatureRow[]): CrossWalkRow[] {
  const naceByCode = new Map<string, NomenclatureRow>();
  const isicByCode = new Map<string, NomenclatureRow>();
  for (const r of rows) {
    if (r.scheme === "NACE_2.0") naceByCode.set(r.code, r);
    if (r.scheme === "ISIC_4") isicByCode.set(r.code, r);
  }
  const out: CrossWalkRow[] = [];
  for (const [code, nace] of naceByCode) {
    if (nace.level === "section") continue; // letters — handled by membership not by row
    const isic = isicByCode.get(code);
    out.push({
      noga_2008: code,
      noga_2025: null,
      nace_2_0: code,
      nace_2_1: null,
      isic_4: isic ? code : null,
      mapping_type: isic ? "exact" : "partial",
      notes: isic ? undefined : "no exact ISIC match for this NACE class — review at division level",
    });
  }
  return out;
}

/**
 * Top-level orchestrator: download what we need, load NACE from package,
 * mirror to NOGA 2008, parse ISIC trilingual, build cross-walks. Returns
 * everything ready for `buildBundle`.
 */
export async function ingestRealClassifications(opts: { cacheDir: string }): Promise<{
  rows: NomenclatureRow[];
  crossWalks: CrossWalkRow[];
  stats: { nace: number; noga2008: number; isic: number; crosswalks: number };
}> {
  if (!existsSync(opts.cacheDir)) mkdirSync(opts.cacheDir, { recursive: true });

  // 1. NACE Rev 2 from package
  const nace = loadNaceFromPackage();

  // 2. NOGA 2008 = NACE Rev 2 (identity)
  const noga2008 = deriveNoga2008FromNace(nace);

  // 3. ISIC Rev 4 from UN, three languages
  const perLang: NomenclatureRow[][] = [];
  for (const lang of ["en", "fr", "es"] as const) {
    const path = join(opts.cacheDir, `isic_rev4_${lang}.txt`);
    await downloadIfStale(ISIC_CSV_BY_LANG[lang], path);
    perLang.push(parseIsicCsvLatin(path, lang));
  }
  const isic = mergeIsicByLang(perLang);

  // 4. Combine
  const rows = [...noga2008, ...nace, ...isic];

  // 5. Cross-walks
  const crossWalks = buildRealCrossWalks(rows);

  return {
    rows,
    crossWalks,
    stats: {
      nace: nace.length,
      noga2008: noga2008.length,
      isic: isic.length,
      crosswalks: crossWalks.length,
    },
  };
}
