// Notice jointe aux nouvelles versions ; les archives déjà signées restent immuables.
export function datasetLicense(dataset: "tares" | "finma" | "classifications"): string {
  const general = `OpenSwissData — ${dataset.toUpperCase()} — notice de licence / Lizenzhinweis / licence notice
Notice du 26.09.2026 — contact@openswissdata.com

FR — Les conditions convenues lors de votre achat définissent vos droits sur la compilation. Une mise à jour de ce fichier ne les réduit pas rétroactivement. L’usage commercial interne et les intégrations autorisées par votre contrat restent permis ; la revente ou republication de notre compilation n’est pas incluse. Les données sources ouvertes conservent leurs licences propres : nous ne revendiquons aucun monopole sur ces données. Conservez les mentions et conditions des sources. Les recours contractuels pour défaut et la garantie commerciale de remboursement restent applicables. Aucune limitation n’exclut une responsabilité pour dol, faute grave, atteinte à la personne ou autre responsabilité impérative. Cette publication est privée, non officielle ; consultez les sources actuelles avant toute décision engageante.
Conditions actuelles : https://www.openswissdata.com/legal/cgv
La copie jointe à votre commande et les accords particuliers priment pour votre achat.

DE — Die beim Kauf vereinbarten Bedingungen bestimmen Ihre Rechte an der Zusammenstellung. Eine Aktualisierung dieser Datei beschränkt sie nicht rückwirkend. Interne geschäftliche Nutzung und vertraglich erlaubte Einbindungen bleiben zulässig; Weiterverkauf oder Wiederveröffentlichung unserer Zusammenstellung sind nicht eingeschlossen. Offene Quelldaten behalten ihre eigenen Lizenzen; wir beanspruchen kein Monopol darauf. Quellenhinweise und Bedingungen sind beizubehalten. Vertragliche Mängelrechte und die freiwillige Erstattungsgarantie bleiben bestehen. Keine Begrenzung schliesst Vorsatz, grobe Fahrlässigkeit, Personenschäden oder andere zwingende Haftung aus. Diese private Veröffentlichung ist nicht amtlich; prüfen Sie vor folgenreichen Entscheidungen die aktuellen Quellen.
Aktuelle AGB: https://www.openswissdata.com/de/legal/cgv
Für Ihren Kauf gehen die bei der Bestellung beigefügte Fassung und besondere Vereinbarungen vor.

EN — The terms agreed at purchase define your rights in the compilation. Updating this file does not retrospectively reduce them. Internal business use and integrations authorised by your contract remain permitted; resale or republication of our compilation is not included. Open source data retains its own licences: we claim no monopoly over it. Preserve source notices and conditions. Contractual defect remedies and the voluntary refund guarantee remain applicable. No limitation excludes fraud, wilful misconduct, gross negligence, personal injury or other mandatory liability. This private publication is unofficial; check current authoritative sources before consequential decisions.
Current terms: https://www.openswissdata.com/en/legal/cgv
The copy attached to your order and any specific agreements prevail for your purchase.
`;
  const sources = {
    tares: `
TARES — CONDITIONS DE SOURCE / QUELLENBEDINGUNGEN / SOURCE CONDITIONS
Conditions communiquées par l’OFDF/BAZG le 21.04.2026.
DE: Dies ist keine offizielle Veröffentlichung. Massgebend sind allein die Veröffentlichungen durch die Bundeskanzlei und das Bundesamt für Zoll- und Grenzsicherheit BAZG.
FR: Ceci n’est pas une publication officielle. Seules les publications de la Chancellerie fédérale et de l’Office fédéral de la douane et de la sécurité des frontières BAZG font foi.
EN: This is not an official publication. Only publications of the Federal Chancellery and the Federal Office for Customs and Border Security (FOCBS/BAZG) are authoritative.
Source: https://xtares.admin.ch/
Source content (codes, rates, regimes and designations) must not be altered. Format, encoding and indexing may change without changing meaning. Keep the unofficial-publication notice and source reference with permitted derivatives. Do not use BAZG logos, official branding or names in a way suggesting an official publication. BAZG Erläuterungen (explanatory notes) and Entscheide (classification decisions) are excluded.
BAZG provides no warranty, support or interpretation assistance for this republication. Errors cannot be invoked against customs assessment, duty collection or criminal proceedings. Jurisdiction for TARES-related disputes: Bern, subject to mandatory jurisdiction rules.
`,
    finma: `
FINMA / GLEIF — CONDITIONS DE SOURCE / QUELLENBEDINGUNGEN / SOURCE CONDITIONS
Source: FINMA, https://www.finma.ch/ ; conditions: https://www.finma.ch/en/terms-and-conditions/
The FINMA correspondence dated 6 May 2026 requires respect for copyright and the integrity of source documents. Retain source attribution and do not imply affiliation, certification or approval. This compilation does not replace consultation of the official current register. A missing or matching entry is not itself a compliance or risk conclusion.
LEI enrichment source: GLEIF, https://www.gleif.org/en/meta/lei-data-terms-of-use — CC0 1.0. These open-data rights remain separate from our compilation licence. Source details and collection dates are documented in the archive.
`,
    classifications: `
CLASSIFICATIONS — CONDITIONS DE SOURCE / QUELLENBEDINGUNGEN / SOURCE CONDITIONS
NOGA: Office fédéral de la statistique / Bundesamt für Statistik (BFS/FSO).
NACE: European Commission, Eurostat. ISIC: United Nations Statistics Division.
Retain source attribution, revision and date. Source conditions and third-party rights remain applicable; public availability alone does not grant unrestricted redistribution. Source URLs and mappings are documented in the archive. The compilation is unofficial and not endorsed by these organisations. A mapping may be partial, approximate or one-to-many: consult its relation type and the quality report. No STATENT data is included in the currently distributed service.
`,
  };
  return general + sources[dataset];
}
