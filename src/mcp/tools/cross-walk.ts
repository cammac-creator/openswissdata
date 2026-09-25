/** Réponses fondées sur des relations par paire ; aucune égalité de code présumée. */
import { z } from "zod";
import { getClassificationLinks } from "../data-loader.js";
import { CLASSIFICATION_SCHEMES, resolveClassificationLinks, type ClassificationMapping, type ClassificationScheme, type ClassificationSource } from "../../lib/classification-links.js";

export const crossWalkSchema = {
  type: "object",
  properties: {
    code: { type: "string", description: "Code source, avec ou sans point (01, 6201, 47.91)." },
    source: { type: "string", enum: [...CLASSIFICATION_SCHEMES] },
    target: { type: "string", enum: [...CLASSIFICATION_SCHEMES] },
  },
  required: ["code", "source", "target"],
} as const;
const InputZ = z.object({ code: z.string().trim().min(1).max(16),
  source: z.enum(CLASSIFICATION_SCHEMES), target: z.enum(CLASSIFICATION_SCHEMES) });
export interface CrossWalkMapping extends ClassificationMapping { notes: string }
export interface CrossWalkResult {
  source_scheme: ClassificationScheme;
  target_scheme: ClassificationScheme;
  source_code: string;
  mappings: CrossWalkMapping[];
  count: number;
  reference_version: string;
  sources: readonly ClassificationSource[];
  limitations: string[];
}
const descriptions = {
  exactMatch: "Identité documentée par l'OFS aux niveaux 1 à 4.",
  closeMatch: "Correspondance approchée publiée par Eurostat ; vérifier l'activité et les notes explicatives.",
  broadMatch: "Le code cible couvre un périmètre plus large que le code source.",
  narrowMatch: "Le code cible couvre un périmètre plus étroit ; le choix exige de connaître l'activité.",
  relatedMatch: "Concepts associés ; aucune équivalence automatique affirmée.",
};
export function crossWalkHandler(args: unknown): {
  content: { type: "text"; text: string }[]; isError?: boolean; structured?: CrossWalkResult;
} {
  const parsed = InputZ.safeParse(args);
  if (!parsed.success) return { content: [{ type: "text", text: "Entrée invalide : code et nomenclatures reconnus requis." }], isError: true };
  const { source, target } = parsed.data;
  const raw = parsed.data.code.toUpperCase();
  if (!/^([A-Z]|\d{2,8}|\d{2}\.\d{1,4})$/.test(raw)) return { content: [{ type: "text", text: "Format du code invalide." }], isError: true };
  const code = raw.replaceAll(".", "");
  if (source === target) return { content: [{ type: "text", text: "Les nomenclatures source et cible sont identiques." }], isError: true };
  const reference = getClassificationLinks();
  const mappings = resolveClassificationLinks(reference.links, source, code, target).map(m => ({ ...m, notes: descriptions[m.relation] }));
  const used = new Set(mappings.flatMap(m => m.path.map(p => p.source_id)));
  const result: CrossWalkResult = { source_scheme: source, target_scheme: target, source_code: code,
    mappings, count: mappings.length, reference_version: reference.version,
    sources: reference.sources.filter(s => used.has(s.source_id)),
    limitations: ["closeMatch n'est pas une équivalence exacte.", "Deux liens non exacts successifs ne sont pas chaînés.",
      "Une absence de résultat ne prouve pas l'absence d'équivalent ; une table dédiée ou un examen de l'activité peut être nécessaire."] };
  const lines = mappings.length ? [
    `${source}:${code} → ${target} : ${mappings.length} correspondance(s), référentiel ${reference.version}.`,
    ...mappings.map(m => `${m.target_code} [${m.mapping_type} / ${m.relation}] — ${m.notes}`),
    ...result.sources.map(s => `Source : ${s.url}`),
  ] : [`Aucune correspondance établie entre ${source}:${code} et ${target} par les liens disponibles (référentiel ${reference.version}).`];
  return { content: [{ type: "text", text: [...lines, ...result.limitations].join("\n") }], structured: result };
}
export const crossWalkTool = {
  name: "cross_walk",
  description: "Recherche des correspondances NOGA 2008/2025, NACE 2.0/2.1 et ISIC 4. Retourne la relation exacte ou approchée, les sources et le chemin documenté. Refuse de chaîner deux relations non exactes. Une correspondance non exacte exige une validation métier.",
  inputSchema: crossWalkSchema, handler: crossWalkHandler,
} as const;
