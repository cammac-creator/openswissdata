/** Correspondances sourcées, conservées par paire de nomenclatures. */
export const CLASSIFICATION_SCHEMES = ["NOGA_2008", "NOGA_2025", "NACE_2.0", "NACE_2.1", "ISIC_4"] as const;
export type ClassificationScheme = typeof CLASSIFICATION_SCHEMES[number];
export type ClassificationRelation = "exactMatch" | "closeMatch" | "broadMatch" | "narrowMatch" | "relatedMatch";
export interface ClassificationLink {
  source_scheme: ClassificationScheme;
  source_code: string;
  target_scheme: ClassificationScheme;
  target_code: string;
  relation: ClassificationRelation;
  source_id: string;
}
export interface ClassificationSource {
  source_id: string;
  url: string;
  sha256: string;
  fetched_at: string;
  version: string;
}
export function isDocumentedOfsIdentity(link: ClassificationLink): boolean {
  return link.source_id === "ofs-methodologie" && link.source_code === link.target_code &&
    /^([A-Z]|\d{2,4})$/.test(link.source_code) &&
    ((link.source_scheme === "NOGA_2008" && link.target_scheme === "NACE_2.0") ||
     (link.source_scheme === "NOGA_2025" && link.target_scheme === "NACE_2.1"));
}
export interface ClassificationMapping {
  source_code: string;
  target_code: string;
  mapping_type: "exact" | "partial" | "aggregated";
  relation: ClassificationRelation;
  requires_review: boolean;
  path: ClassificationLink[];
}

const inverse: Record<ClassificationRelation, ClassificationRelation> = {
  exactMatch: "exactMatch", closeMatch: "closeMatch", relatedMatch: "relatedMatch",
  broadMatch: "narrowMatch", narrowMatch: "broadMatch",
};

/**
 * Un chemin contient des identités documentées et au plus une relation non exacte.
 * Deux closeMatch successifs ne prouvent aucune relation : ils ne sont pas transitifs.
 * Ne jamais rejoindre deux nomenclatures par la seule ressemblance de leurs codes.
 */
export function resolveClassificationLinks(
  links: readonly ClassificationLink[], source: ClassificationScheme, code: string,
  target: ClassificationScheme,
): ClassificationMapping[] {
  const key = (scheme: ClassificationScheme, value: string) => `${scheme}:${value}`;
  const edges = new Map<string, ClassificationLink[]>();
  for (const link of links) {
    const reverse: ClassificationLink = { ...link, source_scheme: link.target_scheme,
      source_code: link.target_code, target_scheme: link.source_scheme,
      target_code: link.source_code, relation: inverse[link.relation] };
    for (const edge of [link, reverse]) {
      const k = key(edge.source_scheme, edge.source_code);
      const list = edges.get(k) ?? []; list.push(edge); edges.set(k, list);
    }
  }
  const queue: { scheme: ClassificationScheme; code: string; path: ClassificationLink[]; relation: ClassificationRelation; seen: Set<ClassificationScheme> }[] = [
    { scheme: source, code, path: [], relation: "exactMatch", seen: new Set([source]) },
  ];
  const found = new Map<string, ClassificationMapping>();
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    for (const edge of edges.get(key(node.scheme, node.code)) ?? []) {
      if (node.seen.has(edge.target_scheme)) continue;
      if (node.relation !== "exactMatch" && edge.relation !== "exactMatch") continue;
      const relation = edge.relation === "exactMatch" ? node.relation : edge.relation;
      const path = [...node.path, edge];
      if (edge.target_scheme === target) {
        const mapping: ClassificationMapping = {
          source_code: code, target_code: edge.target_code, relation,
          mapping_type: relation === "exactMatch" ? "exact" : relation === "broadMatch" ? "aggregated" : "partial",
          requires_review: relation !== "exactMatch", path,
        };
        const existing = found.get(edge.target_code);
        if (!existing || (existing.relation !== "exactMatch" && relation === "exactMatch") ||
            (existing.relation === relation && existing.path.length > path.length)) found.set(edge.target_code, mapping);
      } else {
        queue.push({ scheme: edge.target_scheme, code: edge.target_code, path, relation,
          seen: new Set([...node.seen, edge.target_scheme]) });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.target_code.localeCompare(b.target_code));
}
