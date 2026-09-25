/** Tables officielles → liens directs, sans équivalence déduite du numéro de code. */
import { readFileSync } from "node:fs";
import type { NomenclatureRow, CrossWalkRow } from "./types.js";
import type { ClassificationLink, ClassificationRelation, ClassificationScheme } from "../../src/lib/classification-links.js";

export const NACE_ISIC_QUERY = `PREFIX xkos: <http://rdf-vocabulary.ddialliance.org/xkos#>
SELECT ?association ?source ?target ?relation WHERE {
 <http://data.europa.eu/ux2/nace2/NACE2_ISIC4> xkos:madeOf ?association .
 ?association xkos:sourceConcept ?source ; xkos:targetConcept ?target .
 OPTIONAL { VALUES ?relation { <http://www.w3.org/2004/02/skos/core#exactMatch> <http://www.w3.org/2004/02/skos/core#closeMatch> <http://www.w3.org/2004/02/skos/core#broadMatch> <http://www.w3.org/2004/02/skos/core#narrowMatch> <http://www.w3.org/2004/02/skos/core#relatedMatch> } ?source ?relation ?target . }
} ORDER BY ?source ?target`;
export const NACE_ISIC_URL = "https://publications.europa.eu/webapi/rdf/sparql?" +
  new URLSearchParams({ query: NACE_ISIC_QUERY, format: "application/sparql-results+json" });
export const OFS_METHODOLOGY_URL = "https://dam-api.bfs.admin.ch/hub/api/dam/assets/33787996/master";

export function parseNaceIsicLinks(path: string): ClassificationLink[] {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data.results?.bindings) || !data.results.bindings.length) throw new Error("Table Eurostat NACE/ISIC vide ou invalide");
  return data.results.bindings.map((r: Record<string, { type: string; value: string }>) => {
    const source = r.source?.value?.match(/^http:\/\/data\.europa\.eu\/ux2\/nace2\/([A-Z]|\d{2,4})$/)?.[1];
    const target = r.target?.value?.match(/^https:\/\/unstats\.un\.org\/classifications\/ISIC\/rev4\/([A-Z]|\d{2,4})$/)?.[1];
    const relation = r.relation?.value?.match(/^http:\/\/www\.w3\.org\/2004\/02\/skos\/core#(exactMatch|closeMatch|broadMatch|narrowMatch|relatedMatch)$/)?.[1];
    if (!source || !target || !relation || [r.source, r.target, r.relation].some(x => x.type !== "uri")) {
      throw new Error("Relation Eurostat absente ou non reconnue : contrôle manuel nécessaire");
    }
    return { source_scheme: "NACE_2.0", source_code: source, target_scheme: "ISIC_4", target_code: target,
      relation: relation as ClassificationRelation, source_id: "eurostat-nace2-isic4" };
  });
}

export function buildClassificationLinks(rows: readonly NomenclatureRow[],
  nace21To20: ReadonlyMap<string, string[]>, naceIsic: readonly ClassificationLink[] = []): ClassificationLink[] {
  const index = new Map(rows.map(r => [`${r.scheme}:${r.code}`, r]));
  if (index.size !== rows.length) throw new Error("Codes de nomenclature dupliqués");
  const links: ClassificationLink[] = [];
  const add = (link: ClassificationLink) => {
    if (!index.has(`${link.source_scheme}:${link.source_code}`) || !index.has(`${link.target_scheme}:${link.target_code}`)) {
      throw new Error(`Correspondance vers un code absent : ${link.source_scheme}:${link.source_code} → ${link.target_scheme}:${link.target_code}`);
    }
    links.push(link);
  };
  for (const [noga, nace] of [["NOGA_2008", "NACE_2.0"], ["NOGA_2025", "NACE_2.1"]] as const) {
    for (const row of rows.filter(r => r.scheme === noga)) {
      if (row.level === "subclass") {
        // Le parent i14y est utilisé, jamais les chiffres coupés arbitrairement.
        const parent = row.parent && index.get(`${noga}:${row.parent}`);
        if (!parent || parent.level !== "class") throw new Error(`Parent suisse invalide : ${noga}:${row.code}`);
        add({ source_scheme: noga, source_code: row.code, target_scheme: nace, target_code: parent.code,
          relation: "broadMatch", source_id: noga === "NOGA_2008" ? "ofs-noga2008" : "ofs-noga2025" });
      } else {
        const counterpart = index.get(`${nace}:${row.code}`);
        if (!counterpart || counterpart.level !== row.level) throw new Error(`Identité OFS non retrouvée : ${noga}:${row.code}`);
        add({ source_scheme: noga, source_code: row.code, target_scheme: nace, target_code: row.code,
          relation: "exactMatch", source_id: "ofs-methodologie" });
      }
    }
  }
  for (const [source, targets] of nace21To20) for (const target of targets) {
    add({ source_scheme: "NACE_2.1", source_code: source, target_scheme: "NACE_2.0", target_code: target,
      relation: "closeMatch", source_id: "eurostat-nace21" });
  }
  for (const link of naceIsic) add(link);
  const key = (l: ClassificationLink) => [l.source_scheme, l.source_code, l.target_scheme, l.target_code, l.relation].join("|");
  return [...new Map(links.map(l => [key(l), l])).values()].sort((a, b) => key(a).localeCompare(key(b)));
}

/** Format historique : une ligne ne contient désormais qu'une paire documentée. */
export function linksToLegacyCrossWalks(links: readonly ClassificationLink[]): CrossWalkRow[] {
  const column: Record<ClassificationScheme, "noga_2008" | "noga_2025" | "nace_2_0" | "nace_2_1" | "isic_4"> = {
    NOGA_2008: "noga_2008", NOGA_2025: "noga_2025", "NACE_2.0": "nace_2_0", "NACE_2.1": "nace_2_1", ISIC_4: "isic_4",
  };
  return links.map(l => ({ noga_2008: null, noga_2025: null, nace_2_0: null, nace_2_1: null, isic_4: null,
    [column[l.source_scheme]]: l.source_code, [column[l.target_scheme]]: l.target_code,
    mapping_type: l.relation === "exactMatch" ? "exact" : l.relation === "broadMatch" ? "aggregated" : "partial",
    notes: `${l.source_scheme} → ${l.target_scheme} ; ${l.relation} ; source=${l.source_id}. ${l.relation === "exactMatch" ? "Identité documentée." : "Validation métier requise ; aucune équivalence exacte affirmée."}`,
  }));
}
