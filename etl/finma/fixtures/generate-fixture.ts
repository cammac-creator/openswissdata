import { utils, writeFile } from "xlsx";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BANKS = [
  ["Name", "UID", "Canton", "Address", "Licence date", "Status", "Licence type"],
  ["UBS Switzerland AG", "CHE-101.329.561", "ZH", "Bahnhofstrasse 45, 8001 Zürich", "15.06.2014", "active", "bank"],
  ["Credit Suisse (Schweiz) AG", "CHE-277.408.569", "ZH", "Paradeplatz 8, 8001 Zürich", "01.12.2016", "active", "bank"],
  ["Zürcher Kantonalbank", "CHE-105.958.547", "ZH", "Bahnhofstrasse 9, 8001 Zürich", "01.01.1870", "active", "cantonal bank"],
  ["PostFinance AG", "CHE-114.583.453", "BE", "Mingerstrasse 20, 3030 Bern", "26.06.2013", "active", "bank"],
  ["Raiffeisen Schweiz Genossenschaft", "CHE-109.836.898", "SG", "Raiffeisenplatz, 9001 St. Gallen", "01.01.1902", "active", "bank"],
];

const PSP = [
  ["Name", "UID", "Canton", "Address", "Licence date", "Licence type"],
  ["Sygnum Bank AG", "CHE-387.648.322", "ZH", "Uetlibergstrasse 134a, 8045 Zürich", "27.08.2019", "bank"],
  ["Yapeal AG", "CHE-467.089.214", "ZH", "Bahnhofstrasse 23, 8001 Zürich", "12.03.2020", "fintech licence"],
  ["Neon Switzerland AG", "CHE-329.521.167", "ZH", "Zwingliplatz 4, 8001 Zürich", "01.09.2021", "fintech licence"],
  ["Revolut Bank UAB (ZH Branch)", "CHE-444.112.987", "ZH", "Europaallee 41, 8004 Zürich", "10.01.2022", "branch"],
];

const INSURANCE = [
  ["Name", "UID", "Canton", "Address", "Licence date", "Status"],
  ["Zurich Insurance Company Ltd", "CHE-105.824.036", "ZH", "Mythenquai 2, 8002 Zürich", "01.01.1872", "active"],
  ["Swiss Life AG", "CHE-105.992.623", "ZH", "General-Guisan-Quai 40, 8022 Zürich", "01.10.1857", "active"],
  ["AXA Schweiz AG", "CHE-105.812.519", "AG", "General-Guisan-Strasse 40, 8400 Winterthur", "01.01.1875", "active"],
  ["Die Mobiliar", "CHE-105.938.445", "BE", "Bundesgasse 35, 3011 Bern", "01.01.1826", "active"],
];

const ASSET_MGR_IND = [
  ["Name", "UID", "Canton", "Address", "Licence date"],
  ["Pictet Asset Management SA", "CHE-105.855.108", "GE", "Route des Acacias 60, 1211 Genève", "15.01.2020"],
  ["Swissquote Bank SA", "CHE-105.944.283", "VD", "Chemin de la Crétaux 33, 1196 Gland", "01.04.2018"],
];

function writeXlsxFrom2DArray(rows: unknown[][], sheetName: string, outPath: string): void {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet(rows), sheetName);
  writeFile(wb, outPath);
}

async function main() {
  const outDir = __dirname;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  writeXlsxFrom2DArray(BANKS, "Banks", join(outDir, "finma-banks-sample.xlsx"));
  console.log("Wrote finma-banks-sample.xlsx");
  writeXlsxFrom2DArray(PSP, "PSP", join(outDir, "finma-psp-sample.xlsx"));
  console.log("Wrote finma-psp-sample.xlsx");
  writeXlsxFrom2DArray(INSURANCE, "Insurance", join(outDir, "finma-insurance-sample.xlsx"));
  console.log("Wrote finma-insurance-sample.xlsx");
  writeXlsxFrom2DArray(ASSET_MGR_IND, "AssetManagers", join(outDir, "finma-asset-manager-individual-sample.xlsx"));
  console.log("Wrote finma-asset-manager-individual-sample.xlsx");
}

main().catch(e => { console.error(e); process.exit(1); });
