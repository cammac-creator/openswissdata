/** Une source publique lue par OpenSwissData (registre unique : canari, produits, provenance). Tâche osd.socle. */
// "swisstopo" (minuscule, pas un acronyme comme les autres) : nom retenu par la décision du
// 06.10.2026 pour la source `swisstopo.localities` (tâche osd.localites).
export type Institution = "BAZG" | "FINMA" | "BFS" | "Eurostat" | "UNSD" | "GLEIF" | "US Census" | "OFRC" | "swisstopo";
// `raw` hashes bytes — use for files published in discrete versions (e.g. XLSX
// releases). `json-shape` hashes only structural keys/types — use for JSON APIs.
// `csv-shape` hashes only the header row + separator — use for CSVs that update
// continuously (rows added/removed daily) where only schema changes matter.
// `document` hashes the bytes of a non-XLSX document (RDF, TXT, PDF) published
// in discrete versions : même adresse que la publication, pour voir un blocage avant elle.
// `xlsx-shape` : nom de la feuille et ligne d'en-tête d'un classeur régénéré
// chaque jour (listes FINMA) ; les lignes ajoutées ou retirées ne comptent pas.
export type CanaryMode = "raw" | "json-shape" | "csv-shape" | "document" | "xlsx-shape";
export interface SourceLicence {
  reference: string;   // référence de permission ou « PUBLIC-OFFICIAL-SOURCE-… »
  authority: string;   // autorité qui publie
  date?: string;        // date d'une permission écrite (AAAA-MM-JJ)
  jurisdiction: string;
}
export interface SourceDescriptor {
  id: string;            // « institution.nom », stable : il apparaît dans les manifestes signés
  institution: Institution;
  url: string;           // adresse lue (ou point d'entrée de l'API)
  canary?: CanaryMode;   // absent : la source n'est pas surveillée par le canari
  licence: SourceLicence;
  description: string;   // reprise mot pour mot de la description du canari quand elle existe
}
