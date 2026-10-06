/**
 * Tool: company_check (tâche osd.fiche, tâche 5)
 *
 * Ouvert aux agents sans clé depuis l'accord de Claude-Alain du 06.10.2026 (« go fiche ») :
 * enregistré dans `src/mcp/server.ts`, portée `finma:read`. Produit une entrée MCP
 * sur le modèle exact de `kyc-check.ts`, qui enveloppe `companyCheck` (`../company/check.ts`,
 * tâche 4) : une seule entrée — un IDE suisse — zéro score, zéro verdict, uniquement des
 * faits datés et sourcés, plus des recoupements EXACTS entre sources.
 *
 * `companyCheckHandler` accepte des `deps` injectées (tests, fixtures, horloge figée) et
 * retombe par défaut sur `fetch`/`Date.now` du moment de l'appel — jamais capturés au
 * chargement du module, pour ne jamais figer une référence à `globalThis.fetch` qu'un test
 * ou un futur remplacement global rendrait obsolète.
 */

import { z } from "zod";
import { companyCheck } from "../company/check.js";
import type { CompanyFiche, Fact } from "../company/check.js";
import type { LiveDeps } from "../company/types.js";
import type { FinmaRegistryRow } from "../data-loader.js";

export const companyCheckSchema = {
  type: "object",
  properties: {
    uid: {
      type: "string",
      minLength: 9,
      maxLength: 20,
      description: "Swiss UID (CHE-xxx.xxx.xxx)",
    },
  },
  required: ["uid"],
  additionalProperties: false,
} as const;

const InputZ = z
  .object({
    uid: z.string().min(9).max(20),
  })
  .strict();

export type CompanyCheckDeps = LiveDeps & { finma?: () => readonly FinmaRegistryRow[] };

/** Lit `globalThis.fetch` À L'APPEL (jamais une référence prise au chargement du module). */
function defaultFetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  return globalThis.fetch(...args);
}

// Longueur maximale d'une valeur dans le résumé texte (le `but` d'une société peut faire
// plusieurs centaines de caractères) : le résumé reste court, `structured` garde la fiche
// entière avec chaque valeur intacte (correction après relecture, 06.10.2026).
const MAX_VALUE_LENGTH = 160;

function truncateValue(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}… (full text in structured)` : value;
}

function renderFacts(facts: readonly Fact[]): string[] {
  return facts.map((f) => `  - ${f.field}: ${truncateValue(String(f.value))}`);
}

/** Heure de lecture commune aux faits d'un groupe (tous émis avec le même `retrieved_at` —
 *  voir `lindasFacts`/`gleifFacts`/`finmaFacts` dans `check.ts`) ; repli sur `generated_at`
 *  pour un groupe sans aucun fait (non trouvé ou indisponible). */
function groupTime(facts: readonly Fact[], generatedAt: string): string {
  return facts[0]?.retrieved_at ?? generatedAt;
}

function renderCommercialRegister(fiche: CompanyFiche): string[] {
  const cr = fiche.commercial_register;
  if (!cr.available) {
    return [`Commercial register (LINDAS): not available (${cr.reason ?? "unknown reason"}).`];
  }
  if (!cr.found) {
    return ["Commercial register (LINDAS): no record found for this UID."];
  }
  const time = groupTime(cr.facts, fiche.generated_at);
  return [`Commercial register (LINDAS, read ${time}):`, ...renderFacts(cr.facts)];
}

function renderFinma(fiche: CompanyFiche): string[] {
  const f = fiche.finma;
  const lines: string[] = [];
  // `retrieved_at` des faits FINMA (relecture finale du 06.10.2026) : la date ISO de la
  // version FINMA servie quand elle est connue, sinon `null` — jamais `generated_at`, qui
  // daterait la fabrication de la fiche, pas une lecture (voir `finmaRetrievedAt` dans
  // `check.ts`). La phrase mentionne cette date SEULEMENT quand elle est connue.
  if (!f.available) {
    lines.push(`FINMA copy: not available (${f.reason ?? "unknown reason"}). ${f.data_note}`);
  } else if (!f.found) {
    lines.push(`FINMA copy (as loaded by this service, fiche generated ${fiche.generated_at}): no authorisation entry found for this UID. ${f.data_note}`);
  } else {
    const readAt = f.facts[0]?.retrieved_at;
    const readClause = readAt ? `, read ${readAt}` : "";
    lines.push(`FINMA copy (as loaded by this service${readClause}, fiche generated ${fiche.generated_at}): ${f.data_note}`);
    lines.push(...renderFacts(f.facts));
  }
  lines.push("FINMA warning list: not checkable by UID.");
  return lines;
}

function renderLei(fiche: CompanyFiche): string[] {
  const lei = fiche.lei;
  if (!lei.available) {
    return [`LEI records (GLEIF): not available (${lei.reason ?? "unknown reason"}).`];
  }
  if (!lei.found) {
    return ["LEI records (GLEIF): no record found for this UID."];
  }
  const time = groupTime(lei.facts, fiche.generated_at);
  return [`LEI records (GLEIF, read ${time}):`, ...renderFacts(lei.facts)];
}

function renderCrossChecks(fiche: CompanyFiche): string[] {
  const lines: string[] = ["Cross-checks:"];
  if (fiche.cross_checks.length === 0) {
    lines.push("  (none: not enough matching sources to compare)");
    return lines;
  }
  for (const c of fiche.cross_checks) {
    lines.push(`  - ${c.check} (${c.sources.join(" vs ")}): ${c.result ? "identical" : "different"} — ${c.detail}`);
  }
  return lines;
}

/**
 * Vérifications de l'adresse LINDAS contre le répertoire officiel des localités
 * (swisstopo) : section DISTINCTE de « Cross-checks » (décision de Claude-Alain du
 * 06.10.2026, tâche osd.localites, tâche 2) — ce sont des comparaisons à une référence
 * officielle, pas un recoupement entre deux sources qui se corroborent. `fiche.address_checks`
 * est TOUJOURS présent (jamais absent) : vide quand il n'y a pas d'adresse publiée ou que le
 * répertoire n'est pas disponible, affiché ici en clair sans mot de verdict.
 */
function renderAddressChecks(fiche: CompanyFiche): string[] {
  const lines: string[] = ["Address checks (official locality directory, swisstopo):"];
  if (fiche.address_checks.length === 0) {
    lines.push("  (none: no published commercial register address to check, or the directory is not available)");
    return lines;
  }
  for (const c of fiche.address_checks) {
    lines.push(`  - ${c.check}: ${c.result ? "identical" : "different"} — ${c.detail}`);
  }
  return lines;
}

/**
 * Résumé lisible (`content[0].text`) : factuel, en anglais, qui cite pour chaque groupe sa
 * source et l'heure de lecture, liste les recoupements en "identical"/"different", et
 * rappelle ce qui n'est pas couvert ainsi que la notice. AUCUN mot de verdict — vérifié par
 * `tests/mcp/company-check-tool.test.ts` sur la fiche AXA et sur une fiche avec divergence.
 */
function renderSummary(fiche: CompanyFiche): string {
  const lines: string[] = [];
  lines.push(`Swiss company fiche for ${fiche.uid}, generated ${fiche.generated_at}.`);
  lines.push("");
  lines.push(...renderCommercialRegister(fiche));
  lines.push("");
  lines.push(...renderFinma(fiche));
  lines.push("");
  lines.push(...renderLei(fiche));
  lines.push("");
  lines.push(...renderCrossChecks(fiche));
  lines.push("");
  lines.push(...renderAddressChecks(fiche));
  lines.push("");
  // Phrase claire plutôt qu'une liste de jetons (relecture finale du 06.10.2026) : les
  // lecteurs de ce résumé ne connaissent pas les noms de champs internes de `not_covered`.
  lines.push(
    "This fiche does not say whether the company is still registered (active or deleted), and does not cover FOSC publications, SECO sanctions or officers.",
  );
  lines.push(fiche.notice);
  return lines.join("\n");
}

export async function companyCheckHandler(
  args: unknown,
  deps: CompanyCheckDeps = { fetch: defaultFetch, now: () => Date.now() },
): Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structured?: CompanyFiche;
}> {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const result = await companyCheck(parsed.data.uid, deps);
  if (!result.ok) {
    return {
      content: [{ type: "text", text: `Invalid UID: ${result.reason}` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: renderSummary(result.fiche) }],
    structured: result.fiche,
  };
}

export const companyCheckTool = {
  name: "company_check",
  description:
    "Look up a Swiss company by its UID (CHE-xxx.xxx.xxx): commercial register data (LINDAS), FINMA register entries and LEI records (GLEIF), each fact with its source and, when known, the date it was read, plus exact cross-checks between sources. No score. Commercial register status (active or deleted), FOSC publications, SECO sanctions and officers are not covered.",
  inputSchema: companyCheckSchema,
  handler: companyCheckHandler,
} as const;
