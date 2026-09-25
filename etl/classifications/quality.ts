import type { NomenclatureRow } from "./types.js";
import { CLASSIFICATION_SCHEMES, isDocumentedOfsIdentity, type ClassificationLink, type ClassificationSource } from "../../src/lib/classification-links.js";

/** Aucun fichier vendu ne passe avec une hiérarchie cassée ou une révision confondue. */
export function validateClassifications(rows: readonly NomenclatureRow[], links: readonly ClassificationLink[], sources: readonly ClassificationSource[]) {
  const index = new Map(rows.map(r => [`${r.scheme}:${r.code}`, r]));
  if (index.size !== rows.length) throw new Error("Classifications : codes dupliqués");
  const rank = { section: 1, division: 2, group: 3, class: 4, subclass: 5 };
  const statistics: Record<string, { rows: number; sections: number; classes: number }> = {};
  for (const scheme of CLASSIFICATION_SCHEMES) {
    const subset = rows.filter(r => r.scheme === scheme);
    if (!subset.length) throw new Error(`Nomenclature absente : ${scheme}`);
    statistics[scheme] = { rows: subset.length, sections: subset.filter(r => r.level === "section").length, classes: subset.filter(r => r.level === "class").length };
  }
  // Ces révisions nommées sont fixes : un changement demande un examen explicite.
  if (statistics["NACE_2.0"].rows !== 996 || statistics["NACE_2.0"].sections !== 21 || statistics["NACE_2.0"].classes !== 615) throw new Error("NACE Rev. 2 ne correspond pas à sa structure officielle (996 codes / 615 classes)");
  if (statistics["NACE_2.1"].rows !== 1047 || statistics["NACE_2.1"].sections !== 22 || statistics["NACE_2.1"].classes !== 651) throw new Error("Structure NACE Rev. 2.1 inattendue");
  for (const [scheme, count] of [["NOGA_2008",1790],["NOGA_2025",1845],["ISIC_4",766]] as const) {
    if (statistics[scheme].rows !== count) throw new Error(`Structure ${scheme} modifiée : examen requis avant publication`);
  }
  for (const row of rows) {
    const parent = row.parent && index.get(`${row.scheme}:${row.parent}`);
    if (row.level === "section" ? row.parent !== null : !parent || rank[parent.level] !== rank[row.level] - 1) throw new Error(`Parent invalide : ${row.scheme}:${row.code}`);
    if (!row.label_en?.trim() || !row.label_fr?.trim()) throw new Error(`Libellé FR/EN absent : ${row.scheme}:${row.code}`);
    if (row.scheme !== "ISIC_4" && (!row.label_de?.trim() || !row.label_it?.trim())) throw new Error(`Libellé DE/IT absent : ${row.scheme}:${row.code}`);
  }
  const ids = new Set(sources.map(s => s.source_id));
  if (ids.size !== sources.length || sources.some(s => !/^[a-f0-9]{64}$/.test(s.sha256) || !Number.isFinite(Date.parse(s.fetched_at)) || !s.url.startsWith("https://"))) throw new Error("Provenance classifications invalide");
  const keys = new Set<string>();
  for (const link of links) {
    const key = [link.source_scheme, link.source_code, link.target_scheme, link.target_code].join(":");
    if (keys.has(key) || !ids.has(link.source_id) || !index.has(`${link.source_scheme}:${link.source_code}`) || !index.has(`${link.target_scheme}:${link.target_code}`)) throw new Error("Correspondance dupliquée ou dépourvue de provenance/code");
    keys.add(key);
    if (link.relation === "exactMatch" && !isDocumentedOfsIdentity(link)) throw new Error("Nouvelle équivalence exacte : examen requis");
    if (link.source_id === "ofs-methodologie" && (link.source_code !== link.target_code || index.get(`${link.source_scheme}:${link.source_code}`)?.level === "subclass")) throw new Error("Identité OFS appliquée hors de son périmètre");
  }
  if (links.filter(l => l.source_id === "eurostat-nace2-isic4").length !== 996) throw new Error("Couverture Eurostat NACE/ISIC inattendue");
  return { schema_version: 2, checked_at: new Date().toISOString(), rows: rows.length, schemes: statistics,
    links: links.length, exact: links.filter(l => l.relation === "exactMatch").length,
    approximate: links.filter(l => l.relation !== "exactMatch").length, orphan_parents: 0,
    languages: { NOGA_NACE: ["fr", "de", "it", "en"], ISIC_4: ["fr", "en", "es"] },
    limits: ["Liens directs sourcés ; closeMatch ne signifie pas équivalence exacte.",
      "Deux correspondances approchées ne sont pas chaînées automatiquement.",
      "Les genres suisses à six chiffres sont rattachés à leur classe européenne ; la migration entre genres NOGA 2008/2025 exige une table dédiée.",
      "Les lignes du format historique crosswalks sont désormais des paires, pas des équivalences simultanées entre cinq nomenclatures."] };
}
