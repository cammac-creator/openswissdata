/** Une source publique lue par OpenSwissData (registre unique : canari, produits, provenance). Tâche osd.socle. */
export type Institution = "BAZG" | "FINMA" | "BFS" | "Eurostat" | "UNSD" | "GLEIF" | "US Census";
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
