import { utils, writeFile } from "xlsx";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NOGA_2025_SAMPLE = [
  ["Code", "Titre français", "Titel deutsch", "Titolo italiano"],
  ["K", "Activités financières et d'assurance", "Finanz- und Versicherungsdienstleistungen", "Attività finanziarie e assicurative"],
  ["64", "Activités des services financiers, hors assurance", "Erbringung von Finanzdienstleistungen, ohne Versicherungen", "Servizi finanziari (esclusi assicurazioni)"],
  ["64.1", "Intermédiation monétaire", "Zentralbanken und Kreditinstitute", "Intermediazione monetaria"],
  ["64.11", "Activités de banque centrale", "Zentralbanken", "Attività della banca centrale"],
  ["64.12", "Autres intermédiations monétaires", "Kreditinstitute (ohne Spezialkreditinstitute)", "Altre intermediazioni monetarie"],
  ["64.19", "Autres intermédiations monétaires spécialisées", "Andere Spezialkreditinstitute", "Altre intermediazioni monetarie specializzate"],
  ["64.2", "Activités des sociétés holding", "Tätigkeit von Holdinggesellschaften", "Attività delle società di partecipazione"],
  ["64.20", "Activités des sociétés holding", "Tätigkeit von Holdinggesellschaften", "Attività delle società di partecipazione"],
  ["84", "Administration publique et défense", "Öffentliche Verwaltung und Verteidigung", "Amministrazione pubblica e difesa"],
  ["84.1", "Administration générale", "Allgemeine öffentliche Verwaltung", "Amministrazione generale"],
  ["84.11", "Administration générale de l'Etat", "Allgemeine öffentliche Verwaltung des Staates", "Amministrazione generale dello Stato"],
  ["84.12", "Administration publique (tutelle) santé, formation", "Öffentliche Verwaltung im Gesundheits-, Bildungs-, Kulturwesen", "Amministrazione pubblica (tutela) salute, istruzione"],
  ["84.2", "Services de prérogative publique", "Auswärtige Angelegenheiten, Verteidigung", "Servizi di prerogativa pubblica"],
  ["84.22", "Défense", "Verteidigung", "Difesa"],
  ["84.23", "Justice", "Rechtspflege", "Giustizia"],
];

const NOGA_2008_SAMPLE = NOGA_2025_SAMPLE.slice(); // slightly different in reality, same structure for test

const NACE_20_CSV = `Order,Level,Code,Parent,Description
1,1,K,,Financial and insurance activities
2,2,64,K,Financial service activities except insurance and pension funding
3,3,64.1,64,Monetary intermediation
4,4,64.11,64.1,Central banking
5,4,64.19,64.1,Other monetary intermediation
6,3,64.2,64,Activities of holding companies
7,4,64.20,64.2,Activities of holding companies
8,1,O,,Public administration and defence
9,2,84,O,Public administration and defence
10,3,84.1,84,Administration of the State
11,4,84.11,84.1,General public administration activities
`;

const NACE_21_CSV = `Order,Level,Code,Parent,Description
1,1,K,,Financial and insurance activities
2,2,64,K,Financial service activities except insurance and pension funding
3,3,64.1,64,Monetary intermediation
4,4,64.11,64.1,Central banking
5,4,64.12,64.1,Other monetary intermediation
6,4,64.19,64.1,Specialised other monetary intermediation
7,3,64.2,64,Activities of holding companies
8,4,64.20,64.2,Activities of holding companies
9,1,O,,Public administration and defence
10,2,84,O,Public administration and defence
11,3,84.1,84,Administration of the State
12,4,84.11,84.1,General public administration activities
`;

const ISIC_4_CSV = `Code,Description,Parent
K,Financial and insurance activities,
64,"Financial service activities, except insurance and pension funding",K
641,Monetary intermediation,64
6411,Central banking,641
6419,Other monetary intermediation,641
642,Activities of holding companies,64
6420,Activities of holding companies,642
O,Public administration and defence,
84,Public administration and defence; compulsory social security,O
841,Administration of the State,84
8411,General public administration activities,841
`;

async function main() {
  const outDir = __dirname;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const wb25 = utils.book_new();
  utils.book_append_sheet(wb25, utils.aoa_to_sheet(NOGA_2025_SAMPLE), "NOGA 2025");
  writeFile(wb25, join(outDir, "noga-2025-sample.xlsx"));
  console.log("Wrote noga-2025-sample.xlsx");

  const wb08 = utils.book_new();
  utils.book_append_sheet(wb08, utils.aoa_to_sheet(NOGA_2008_SAMPLE), "NOGA 2008");
  writeFile(wb08, join(outDir, "noga-2008-sample.xlsx"));
  console.log("Wrote noga-2008-sample.xlsx");

  writeFileSync(join(outDir, "nace-2.0-sample.csv"), NACE_20_CSV, "utf8");
  console.log("Wrote nace-2.0-sample.csv");
  writeFileSync(join(outDir, "nace-2.1-sample.csv"), NACE_21_CSV, "utf8");
  console.log("Wrote nace-2.1-sample.csv");
  writeFileSync(join(outDir, "isic-4-sample.csv"), ISIC_4_CSV, "utf8");
  console.log("Wrote isic-4-sample.csv");
}

main().catch(e => { console.error(e); process.exit(1); });
