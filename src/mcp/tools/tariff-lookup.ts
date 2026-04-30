/**
 * Tool: tariff_lookup
 *
 * Lookup a Swiss customs tariff (HS8) and return the full row + a mandatory
 * non-official disclaimer in the content payload itself (so an agent can't
 * silently strip it from a separate field).
 */

import { z } from "zod";
import { getTares } from "../data-loader.js";

export const tariffLookupSchema = {
  type: "object",
  properties: {
    hs8: { type: "string", pattern: "^\\d{8}$", description: "8-digit Swiss tariff number" },
    lang: { type: "string", enum: ["fr", "de", "it", "en"], default: "fr" },
  },
  required: ["hs8"],
} as const;

const InputZ = z.object({
  hs8: z.string().regex(/^\d{8}$/),
  lang: z.enum(["fr", "de", "it", "en"]).default("fr"),
});

const DISCLAIMERS = {
  fr: "AVIS NON-OFFICIEL : ces données sont une copie OpenSwissData de la TARES (BAZG/OFDF) et ne remplacent pas la consultation officielle sur xtares.admin.ch. OpenSwissData ne garantit ni l'exactitude ni l'actualité, et n'est pas responsable des décisions douanières prises sur cette base.",
  de: "INOFFIZIELLER HINWEIS: Diese Daten sind eine OpenSwissData-Kopie der TARES (BAZG/OFDF) und ersetzen nicht die offizielle Konsultation auf xtares.admin.ch. OpenSwissData garantiert weder Genauigkeit noch Aktualität und haftet nicht für daraus abgeleitete Zollentscheidungen.",
  it: "AVVISO NON UFFICIALE: questi dati sono una copia OpenSwissData del TARES (BAZG/OFDF) e non sostituiscono la consultazione ufficiale su xtares.admin.ch. OpenSwissData non garantisce né l'esattezza né l'attualità e non è responsabile delle decisioni doganali prese su questa base.",
  en: "UNOFFICIAL NOTICE: this data is an OpenSwissData copy of TARES (BAZG/FOCBS) and does not replace the official consultation on xtares.admin.ch. OpenSwissData does not warrant accuracy or freshness and is not liable for any customs decision based on it.",
} as const;

export interface TariffLookupResult {
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

export function tariffLookupHandler(args: unknown): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: TariffLookupResult;
} {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const { hs8, lang } = parsed.data;
  const { byHs8 } = getTares();
  const row = byHs8.get(hs8);
  if (!row) {
    return {
      content: [{ type: "text", text: `No TARES row found for HS8 code "${hs8}".` }],
      isError: true,
    };
  }

  const designation = (row[`designation_${lang}` as const] as string) || row.designation_fr;
  const dutyValueRaw = row.duty_mfn_value;
  const dutyValue = dutyValueRaw && dutyValueRaw !== "" ? Number(dutyValueRaw) : null;

  const result: TariffLookupResult = {
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
    "",
    `HS8 ${result.hs8} — ${result.designation}`,
    `Chapter ${result.chapter} / Heading ${result.heading} / HS6 ${result.hs6}`,
    `MFN duty: ${result.duty_mfn.value ?? "n/a"} ${result.duty_mfn.unit ?? ""} ${result.duty_mfn.currency ?? ""}`.trim(),
    `Statistical unit: ${result.unit_stat}`,
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
    "Lookup a Swiss customs tariff (HS8) and return the full TARES row including MFN duty, preferential regimes, restrictions and customs relief codes. Always returns a non-official disclaimer that the agent must surface to the end user.",
  inputSchema: tariffLookupSchema,
  handler: tariffLookupHandler,
} as const;
