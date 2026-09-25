import { readFileSync } from "node:fs";
import type { NomenclatureRow } from "./types.js";

export const NACE2_QUERY = `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?s ?parent ?en ?fr ?de ?it WHERE {
 ?s skos:inScheme <http://data.europa.eu/ux2/nace2/nace2> .
 OPTIONAL { ?s skos:broader ?parent }
 OPTIONAL { ?s skos:prefLabel ?en . FILTER(lang(?en)="en") }
 OPTIONAL { ?s skos:prefLabel ?fr . FILTER(lang(?fr)="fr") }
 OPTIONAL { ?s skos:prefLabel ?de . FILTER(lang(?de)="de") }
 OPTIONAL { ?s skos:prefLabel ?it . FILTER(lang(?it)="it") }
} ORDER BY ?s`;
export const NACE2_URL = "https://publications.europa.eu/webapi/rdf/sparql?" +
  new URLSearchParams({ query: NACE2_QUERY, format: "application/sparql-results+json" });

/** Ne pas utiliser nace-codes : ce paquet contient NACE 2.1, pas NACE Rev. 2. */
export function parseOfficialNace2(path: string): NomenclatureRow[] {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data.results?.bindings) || !data.results.bindings.length) throw new Error("Structure NACE Rev. 2 absente");
  const uriCode = (uri: unknown) => typeof uri === "string" ? uri.match(/^http:\/\/data\.europa\.eu\/ux2\/nace2\/([A-Z]|\d{2,4})$/)?.[1] : undefined;
  return data.results.bindings.map((r: Record<string, { value: string }>): NomenclatureRow => {
    const code = uriCode(r.s?.value);
    if (!code || (r.parent && !uriCode(r.parent.value))) throw new Error("Identifiant officiel NACE Rev. 2 invalide");
    const label = (lang: string) => {
      const value = r[lang]?.value;
      if (typeof value !== "string" || !value.trim()) throw new Error(`Libellé NACE Rev. 2 absent : ${code}/${lang}`);
      // Les libellés Eurostat portent le code ; retirer uniquement ce préfixe exact.
      return value.startsWith(code + " ") ? value.slice(code.length + 1).trim() : value;
    };
    return { scheme: "NACE_2.0", code, parent: uriCode(r.parent?.value) ?? null,
      level: /^[A-Z]$/.test(code) ? "section" : code.length === 2 ? "division" : code.length === 3 ? "group" : "class",
      label_en: label("en"), label_fr: label("fr"), label_de: label("de"), label_it: label("it") };
  });
}
