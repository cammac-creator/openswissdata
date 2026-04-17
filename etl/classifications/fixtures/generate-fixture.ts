import { utils, writeFile } from "xlsx";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";

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
}

main().catch(e => { console.error(e); process.exit(1); });
