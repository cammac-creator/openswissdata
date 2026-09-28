/**
 * Tool: tariff_lookup
 *
 * Lookup a Swiss customs tariff (HS8) and return the full row + a mandatory
 * non-official disclaimer in the content payload itself (so an agent can't
 * silently strip it from a separate field).
 */

import { z } from "zod";
import { getTares, type TaresRow } from "../data-loader.js";

export const tariffLookupSchema = {
  type: "object",
  properties: {
    hs8: {
      type: "string",
      pattern: "^[0-9][0-9. ]{1,11}$",
      description: "Swiss tariff number: 8 digits for one line (dots allowed, e.g. 8471.3000), or a 2- to 7-digit HS prefix (e.g. the international HS6 code 847130) to list the Swiss 8-digit lines under it",
    },
    lang: { type: "string", enum: ["fr", "de", "it", "en"], default: "fr" },
  },
  required: ["hs8"],
} as const;

// Points et espaces tolérés (8471.3000, 8471 30 00) : seuls les chiffres comptent.
const InputZ = z.object({
  hs8: z.string().max(20).transform((v) => v.replace(/[\s.]/g, "")).pipe(z.string().regex(/^\d{2,8}$/)),
  lang: z.enum(["fr", "de", "it", "en"]).default("fr"),
});

// Nombre maximal de lignes listées pour un préfixe : au-delà, l'agent affine avec plus de chiffres.
const PREFIX_LIST_LIMIT = 40;
const SUGGESTION_LIMIT = 10;

const DISCLAIMERS = {
  fr: "AVIS NON-OFFICIEL : ces données sont une copie OpenSwissData de la TARES (BAZG/OFDF) et ne remplacent pas la consultation officielle sur xtares.admin.ch. OpenSwissData ne garantit ni l'exactitude ni l'actualité, et n'est pas responsable des décisions douanières prises sur cette base.",
  de: "INOFFIZIELLER HINWEIS: Diese Daten sind eine OpenSwissData-Kopie der TARES (BAZG/OFDF) und ersetzen nicht die offizielle Konsultation auf xtares.admin.ch. OpenSwissData garantiert weder Genauigkeit noch Aktualität und haftet nicht für daraus abgeleitete Zollentscheidungen.",
  it: "AVVISO NON UFFICIALE: questi dati sono una copia OpenSwissData del TARES (BAZG/OFDF) e non sostituiscono la consultazione ufficiale su xtares.admin.ch. OpenSwissData non garantisce né l'esattezza né l'attualità e non è responsabile delle decisioni doganali prese su questa base.",
  en: "UNOFFICIAL NOTICE: this data is an OpenSwissData copy of TARES (BAZG/FOCBS) and does not replace the official consultation on xtares.admin.ch. OpenSwissData does not warrant accuracy or freshness and is not liable for any customs decision based on it.",
} as const;

const SUMMARY_NOTES = {
  fr: "Résumé tarifaire : les variantes conditionnelles peuvent être absentes. Consulter les taux détaillés du fichier vendu et Tares officiel ; une absence ne signifie pas gratuité. unit_stat est un ancien alias de l'unité du droit.",
  de: "Tarifübersicht: Bedingte Varianten können fehlen. Die detaillierten Sätze im Datensatz und das offizielle Tares prüfen; fehlende Werte bedeuten keine Zollfreiheit. unit_stat ist eine frühere Bezeichnung der Abgabeneinheit.",
  it: "Riepilogo tariffario: le varianti condizionali possono mancare. Consultare le aliquote dettagliate nel dataset e Tares ufficiale; un valore assente non significa esenzione. unit_stat è un nome storico dell'unità del dazio.",
  en: "Tariff summary: conditional variants may be omitted. Check the detailed rates in the purchased dataset and official Tares; missing values do not mean duty-free. unit_stat is a legacy alias for the duty unit.",
} as const;

export interface TariffLookupResult {
  version: string | null;
  duty_rates_count: number | null;
  summary_note: string;
  hs8: string;
  hs6: string;
  chapter: string;
  heading: string;
  designation: string;
  designations_all: { fr: string; de: string; it: string; en: string };
  unit_stat: string;
  duty_mfn: { value: number | null; unit: string | null; currency: string | null };
  preferential_regimes: Record<string, number | "free">;
  restrictions_codes: string[];
  customs_relief_codes: string[];
  valid_from: string;
  source_url: string;
  disclaimer: string;
}

function safeParseJson<T>(s: string, fallback: T): T {
  if (!s || s === "") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

type Lang = "fr" | "de" | "it" | "en";

function linesUnder(rows: readonly TaresRow[], prefix: string): TaresRow[] {
  return rows.filter((r) => r.hs8.startsWith(prefix)).sort((a, b) => a.hs8.localeCompare(b.hs8));
}

function designationOf(row: TaresRow, lang: Lang): string {
  return (row[`designation_${lang}` as const] as string) || row.designation_fr;
}

function formatLine(row: TaresRow, lang: Lang): string {
  const label = designationOf(row, lang).replace(/\s+/g, " ").trim();
  const short = label.length > 140 ? `${label.slice(0, 137)}...` : label;
  const duty = row.duty_mfn_value !== "" && row.duty_mfn_value != null
    ? `MFN ${row.duty_mfn_value} ${row.duty_mfn_unit ?? ""} ${row.duty_mfn_currency ?? ""}`.replace(/\s+/g, " ").trim()
    : "MFN n/a";
  return `- ${row.hs8} ${short} (${duty})`;
}

export interface TariffPrefixResult {
  version: string | null;
  prefix: string;
  total: number;
  lines: { hs8: string; designation: string; duty_mfn: { value: string | null; unit: string | null; currency: string | null } }[];
  disclaimer: string;
}

/** Préfixe de 2 à 7 chiffres : liste des lignes suisses à 8 chiffres qui le prolongent. */
function listByPrefix(rows: readonly TaresRow[], prefix: string, lang: Lang, version: string | null): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: TariffPrefixResult;
} {
  const matches = linesUnder(rows, prefix);
  if (matches.length === 0) {
    return {
      content: [{ type: "text", text: `No Swiss tariff line starts with "${prefix}". Swiss tariff numbers have 8 digits; the first 6 follow the international HS code.` }],
      isError: true,
    };
  }
  const shown = matches.slice(0, PREFIX_LIST_LIMIT);
  const text = [
    DISCLAIMERS[lang],
    `Version: ${version ?? "unknown (bundled data)"}`,
    "",
    `${matches.length} Swiss tariff line(s) start with ${prefix}${matches.length > shown.length ? ` (first ${shown.length} shown; add digits to narrow)` : ""}:`,
    ...shown.map((r) => formatLine(r, lang)),
    "",
    "Call tariff_lookup with one 8-digit number for its full line: preferential regimes, restrictions and customs relief codes.",
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structured: {
      version,
      prefix,
      total: matches.length,
      lines: shown.map((r) => ({
        hs8: r.hs8,
        designation: designationOf(r, lang),
        duty_mfn: { value: r.duty_mfn_value || null, unit: r.duty_mfn_unit || null, currency: r.duty_mfn_currency || null },
      })),
      disclaimer: DISCLAIMERS[lang],
    },
  };
}

export function tariffLookupHandler(args: unknown): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: TariffLookupResult | TariffPrefixResult;
} {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { hs8, lang } = parsed.data;
  const { rows, byHs8, version } = getTares();
  if (hs8.length < 8) return listByPrefix(rows, hs8, lang, version);
  const row = byHs8.get(hs8);
  if (!row) {
    // Proposer les lignes voisines : un agent connaît souvent le code international à 6 chiffres,
    // pas l'extension suisse à 8 chiffres.
    for (const size of [6, 4]) {
      const near = linesUnder(rows, hs8.slice(0, size));
      if (near.length === 0) continue;
      const shown = near.slice(0, SUGGESTION_LIMIT);
      const text = [
        `No TARES row found for HS8 code "${hs8}". Swiss lines under ${hs8.slice(0, size)} (${near.length}${near.length > shown.length ? `, first ${shown.length} shown` : ""}):`,
        ...shown.map((r) => formatLine(r, lang)),
        "Call tariff_lookup again with one of these 8-digit numbers.",
      ].join("\n");
      return { content: [{ type: "text", text }], isError: true };
    }
    return {
      content: [{ type: "text", text: `No TARES row found for HS8 code "${hs8}", and no Swiss line shares its first 4 digits.` }],
      isError: true,
    };
  }

  const designation = (row[`designation_${lang}` as const] as string) || row.designation_fr;
  const dutyValueRaw = row.duty_mfn_value;
  const dutyValue = dutyValueRaw && dutyValueRaw !== "" ? Number(dutyValueRaw) : null;

  const result: TariffLookupResult = {
    version, duty_rates_count: row.duty_rates_count ? Number(row.duty_rates_count) : null, summary_note: SUMMARY_NOTES[lang],
    hs8: row.hs8,
    hs6: row.hs6,
    chapter: row.chapter,
    heading: row.heading,
    designation,
    designations_all: {
      fr: row.designation_fr,
      de: row.designation_de,
      it: row.designation_it,
      en: row.designation_en,
    },
    unit_stat: row.unit_stat,
    duty_mfn: {
      value: dutyValue !== null && Number.isFinite(dutyValue) ? dutyValue : null,
      unit: row.duty_mfn_unit || null,
      currency: row.duty_mfn_currency || null,
    },
    preferential_regimes: safeParseJson(row.preferential_regimes, {}),
    restrictions_codes: safeParseJson(row.restrictions_codes, []),
    customs_relief_codes: safeParseJson(row.customs_relief_codes, []),
    valid_from: row.valid_from,
    source_url: row.source_url,
    disclaimer: DISCLAIMERS[lang],
  };

  // The disclaimer is inlined into the text payload (not just a separate field)
  // so a model passing `content[0].text` to a downstream caller cannot drop it.
  const text = [
    DISCLAIMERS[lang],
    SUMMARY_NOTES[lang],
    `Version: ${version ?? "unknown (bundled data)"}`,
    "",
    `HS8 ${result.hs8} — ${result.designation}`,
    `Chapter ${result.chapter} / Heading ${result.heading} / HS6 ${result.hs6}`,
    `MFN duty: ${result.duty_mfn.value ?? "n/a"} ${result.duty_mfn.unit ?? ""} ${result.duty_mfn.currency ?? ""}`.trim(),
    `Duty unit (legacy unit_stat): ${result.unit_stat}`,
    `Valid from: ${result.valid_from}`,
    `Source: ${result.source_url}`,
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structured: result,
  };
}

export const tariffLookupTool = {
  name: "tariff_lookup",
  description:
    "Look up the Swiss customs tariff (TARES). An 8-digit Swiss tariff number (dots allowed) returns the full line: designations in FR/DE/IT/EN, MFN duty, preferential regimes, restrictions and customs relief codes. A 2- to 7-digit HS prefix (for example the international HS6 code) lists the Swiss 8-digit lines under it. Every answer carries an unofficial-copy notice that the agent must show to the end user.",
  inputSchema: tariffLookupSchema,
  handler: tariffLookupHandler,
} as const;
