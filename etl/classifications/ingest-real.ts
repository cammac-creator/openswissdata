import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { fetchBronze } from "../shared/bronze.js";
import { buildClassificationLinks, linksToLegacyCrossWalks, parseNaceIsicLinks, NACE_ISIC_URL } from "./links.js";
import type { ClassificationLink } from "../../src/lib/classification-links.js";
import { parseOfficialNace2, NACE2_URL } from "./nace-official.js";
import type { ClassificationSource } from "../../src/lib/classification-links.js";
import { OFS_METHODOLOGY_URL } from "./links.js";
import type { NomenclatureRow, NomenclatureLevel, NomenclatureScheme, CrossWalkRow } from "./types.js";

/** Sources officielles archivées avant lecture ; liens explicites sans identité présumée. */

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
 * Parse the UN ISIC Rev 4 plain CSV. Each row : "code","description". Hierarchy
 * is recovered by string length (or letter for sections). CSV is double-quoted,
 * encoded latin-1 for FR/ES (the UN file uses Windows-1252, not UTF-8).
 */
export function parseIsicCsvLatin(path: string, lang: "en" | "fr" | "es"): NomenclatureRow[] {
  // Certains Node macOS assimilent windows-1252 à latin1 : décodage explicite
  // des 32 positions particulières selon https://encoding.spec.whatwg.org/index-windows-1252.txt.
  const cp1252 = [0x20ac,0x81,0x201a,0x192,0x201e,0x2026,0x2020,0x2021,0x2c6,0x2030,0x160,0x2039,0x152,0x8d,0x17d,0x8f,0x90,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x2dc,0x2122,0x161,0x203a,0x153,0x9d,0x17e,0x178];
  const bytes = readFileSync(path);
  const content = lang === "en" ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) :
    bytes.toString("latin1").replace(/[\u0080-\u009f]/g, char => String.fromCodePoint(cp1252[char.charCodeAt(0) - 0x80]));
  if (/[\u0080-\u009f\ufffd]/.test(content)) throw new Error("Encodage ONU ISIC invalide");
  const records = parse(content, { skip_empty_lines: true, bom: true }) as string[][];
  if (records.length < 2 || records[0].length !== 2 || !/code/i.test(records[0][0])) throw new Error("Structure ONU ISIC invalide");
  const out: NomenclatureRow[] = [];
  const seen = new Set<string>();
  let section: string | null = null;
  for (const cells of records.slice(1)) {
    const code = cells[0]?.trim();
    if (cells.length !== 2 || !/^([A-Z]|\d{2,4})$/.test(code) || !cells[1]?.trim() || seen.has(code)) throw new Error("Ligne ONU ISIC invalide ou dupliquée");
    const level = levelFromCode(code);
    if (level === "section") section = code;
    const parent = level === "section" ? null : level === "division" ? section : code.slice(0, -1);
    if (level !== "section" && (!parent || !seen.has(parent))) throw new Error(`Parent ONU ISIC absent avant ${code}`);
    out.push({ scheme: "ISIC_4", code, level, parent, [lang === "en" ? "label_en" : lang === "fr" ? "label_fr" : "label_es"]: cells[1].trim() });
    seen.add(code);
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
        if (cur.parent !== r.parent || cur.level !== r.level) throw new Error(`Hiérarchie ISIC différente selon la langue : ${r.code}`);
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

async function fetchI14yConcept(conceptId: string, cacheDir: string): Promise<I14yCodeListEntry[]> {
  const url = `${I14Y_API}/concepts/${conceptId}?includeCodeListEntries=true`;
  const path = await fetchBronze(url, cacheDir, `i14y-${conceptId}.json`, { headers: { Accept: "application/json" } });
  const parsed = JSON.parse(readFileSync(path, "utf8")) as I14yConceptResponse;
  if (!Array.isArray(parsed.data?.codeListEntries) || !parsed.data.codeListEntries.length) throw new Error("Liste i14y vide ou invalide");
  return parsed.data.codeListEntries;
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
  const entries = await fetchI14yConcept(NOGA_2025_CONCEPT_ID, cacheDir);
  return i14yToNomenclatureRows(entries, "NOGA_2025");
}

export async function loadNoga2008FromI14y(cacheDir: string): Promise<NomenclatureRow[]> {
  const entries = await fetchI14yConcept(NOGA_2008_CONCEPT_ID, cacheDir);
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

/** Compatibilité des colonnes historiques, avec relations directes uniquement. */
export function buildRealCrossWalks(rows: NomenclatureRow[], closeMatchNace21toNace2: Map<string, string[]>, naceIsic: ClassificationLink[] = []): CrossWalkRow[] {
  return linksToLegacyCrossWalks(buildClassificationLinks(rows, closeMatchNace21toNace2, naceIsic));
}

/**
 * Top-level orchestrator: download what we need, load all 5 schemes from real
 * sources, build cross-walks. Returns everything ready for `buildBundle`.
 */
export async function ingestRealClassifications(opts: { cacheDir: string; maxAgeHours?: number }): Promise<{
  rows: NomenclatureRow[];
  crossWalks: CrossWalkRow[];
  links: ClassificationLink[];
  sources: ClassificationSource[];
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

  const sources: ClassificationSource[] = [];
  const source = async (id: string, url: string, filename: string): Promise<string> => {
    const path = await fetchBronze(url, opts.cacheDir, filename, {}, opts.maxAgeHours ?? 12);
    const meta = JSON.parse(readFileSync(`${path}.meta.json`, "utf8"));
    sources.push({ source_id: id, url, sha256: meta.sha256, fetched_at: meta.fetched_at,
      version: new Date().toISOString().slice(0, 10).replaceAll("-", ".") });
    return path;
  };
  const nace20 = parseOfficialNace2(await source("eurostat-nace2", NACE2_URL, "nace2-structure.json"));
  const nace21Result = parseNace21Rdf(await source("eurostat-nace21", NACE_2_1_RDF_URL, "ESTAT-NACE2.1.rdf"));
  const noga = async (id: string, sourceId: string, scheme: NomenclatureScheme) => {
    const path = await source(sourceId, `${I14Y_API}/concepts/${id}?includeCodeListEntries=true`, `${sourceId}.json`);
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(data.data?.codeListEntries) || !data.data.codeListEntries.length) throw new Error("NOGA i14y vide ou invalide");
    return i14yToNomenclatureRows(data.data.codeListEntries, scheme);
  };
  const noga2008 = await noga(NOGA_2008_CONCEPT_ID, "ofs-noga2008", "NOGA_2008");
  const noga2025 = await noga(NOGA_2025_CONCEPT_ID, "ofs-noga2025", "NOGA_2025");
  const methodology = await source("ofs-methodologie", OFS_METHODOLOGY_URL, "ofs-methodologie.pdf");
  if (readFileSync(methodology).subarray(0, 5).toString() !== "%PDF-") throw new Error("Méthodologie OFS non PDF");

  // 4. ISIC Rev 4 from UN, three languages
  const perLang: NomenclatureRow[][] = [];
  for (const lang of ["en", "fr", "es"] as const) {
    const path = await source(`onu-isic4-${lang}`, ISIC_CSV_BY_LANG[lang], `isic_rev4_${lang}.txt`);
    perLang.push(parseIsicCsvLatin(path, lang));
  }
  const isic = mergeIsicByLang(perLang);

  // 5. Combine all rows
  const rows = [...noga2008, ...noga2025, ...nace20, ...nace21Result.rows, ...isic];

  // 6. Cross-walks (using NACE 2.1 closeMatch triples extracted above)
  const naceIsicPath = await source("eurostat-nace2-isic4", NACE_ISIC_URL, "nace2-isic4.json");
  const links = buildClassificationLinks(rows, nace21Result.closeMatchToNace2, parseNaceIsicLinks(naceIsicPath));
  const crossWalks = linksToLegacyCrossWalks(links);

  return {
    rows,
    crossWalks,
    links,
    sources,
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
