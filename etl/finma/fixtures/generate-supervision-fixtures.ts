/**
 * Fixtures FICTIVES des trois classeurs FINMA lus depuis le 30.09.2026
 * (vvtr.xlsx, sro.xlsx, ao.xlsx). Même mise en page que les vrais fichiers :
 * titre, lignes vides, en-tête décalé, cellules vides, ligne « Total …: N ».
 * Aucun nom réel : tous les noms commencent par « Exemple », les adresses
 * e-mail sont en example.test (elles servent à vérifier qu'elles ne sont
 * jamais reprises dans l'archive).
 *
 * Régénérer : npx tsx etl/finma/fixtures/generate-supervision-fixtures.ts
 */
import { utils, writeFile } from "../../shared/xlsx.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Rows = unknown[][];

export const OS_ALPHA = "Exemple OS Alpha SA";
export const OS_BETA = "Exemple OS Beta AG";

/** Chaque ligne illustre un cas du rapprochement (voir tests/etl/finma-supervision.test.ts). */
export const VVTR_DATA: Rows = [
  ["Exemple Gestion SA", "Lausanne", "X", "", OS_ALPHA, null, ""],            // unique : rattaché
  ["Exemple Trust & Fiducie AG", "Zürich", "X", "X", OS_BETA, null, ""],      // deux autorisations, un UID : les deux lignes
  ["Exemple Doublon SA", "Genève", "X", "", OS_ALPHA, null, ""],              // en double dans la liste : ambigu
  ["Exemple Doublon SA", "Genève", "X", "", OS_BETA, null, ""],
  ["Exemple Deux UID SA", "Bern", "X", "X", OS_ALPHA, null, ""],              // deux UID au registre : ambigu
  ["Exemple Type Trustee GmbH", "Basel", "", "X", OS_BETA, null, ""],         // registre : Portfolio manager seulement
  ["Exemple Absent SA", "Sion", "X", "", OS_ALPHA, null, ""],                 // absent du registre
  ["Exemple  Espaces   SA ", "Lugano", "X", "", OS_BETA, null, ""],          // espaces différents : rattaché
  ["EXEMPLE CASSE SA", "Chur", "X", "", OS_ALPHA, null, ""],                  // casse différente : non rattaché
  ["Exemple Forme SA", "Zug", "X", "", OS_BETA, null, ""],                    // forme juridique différente : non rattaché
];

export function vvtrRows(data: Rows = VVTR_DATA, total = data.length): Rows {
  return [
    ["List of portfolio managers and trustees licensed by FINMA and monitored by a supervisory organisation", null, null, null, null, null, null],
    [null, null, null, null, null, null, null],
    ["", "", "", "", "", null, null],
    ["Name", "City", "Portfolio Manager", "Trustee", "Supervisory organisation", "", ""],
    ...data,
    ["", "", "", "", "", null, null],
    [`Total number of portfolio managers and trustees licensed by FINMA and monitored by a supervisory organisation: ${total}`, "", "", "", "", "", ""],
    [null, null, null, null, null, null, null],
  ];
}

export const SRO_DATA: Rows = [
  ["Exemple OAR Un", null, "Rue de l'Exemple 1\n1000 Lausanne", "+41 00 000 00 01\n", "info@example.test", null, null, "https://oar-un.example.test"],
  ["Exemple OAR Deux (OAR ED)", null, "Beispielstrasse 2\nPostfach\n8000 Zürich", "+41 00 000 00 02\n+41 00 000 00 03", "prenom.nom@example.test", null, null, "http://oar-deux.example.test/"],
];

export function sroRows(data: Rows = SRO_DATA, total = data.length): Rows {
  return [
    [null, "List of self-regulatory organisations (SROs) recognised by FINMA", null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ["Company name", "", "Address", "Tel. / fax", "E-mail", "", "", "Homepage"],
    ...data,
    ["", null, "", "", "", null, null, ""],
    [`Total self-regulatory organisations (SROs) recognised by FINMA: ${total}`, "", "", "", "", "", "", ""],
    [null, null, null, null, null, null, null, null],
  ];
}

export const AO_DATA: Rows = [
  [OS_ALPHA, "Rue de l'Exemple 10", "1000 Lausanne", "+41 00 000 00 10", null, null, "contact@example.test", "https://os-alpha.example.test"],
  [OS_BETA, "Beispielstrasse 20", "8000 Zürich", "+41 00 000 00 20 ", null, null, "prenom.nom@example.test", "http://os-beta.example.test/"],
];

export function aoRows(data: Rows = AO_DATA, total = data.length): Rows {
  return [
    ["List of supervisory organisations authorised by FINMA", null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ["", "", "", "", null, null, "", ""],
    ["Name", "Address", "City", "Telephone", "", "", "E-mail", "Homepage"],
    ...data,
    ["", "", "", "", null, null, "", ""],
    [`Total supervisory organisations authorised by FINMA: ${total}`, "", "", "", "", "", "", ""],
    [null, null, null, null, null, null, null, null],
  ];
}

export function writeWorkbook(rows: Rows, sheetName: string, outPath: string): void {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), sheetName);
  writeFile(workbook, outPath);
}

const entrypoint = process.argv[1] ? `file://${process.argv[1]}` : "";
if (import.meta.url === entrypoint) {
  const outDir = dirname(fileURLToPath(import.meta.url));
  writeWorkbook(vvtrRows(), "vvtr", join(outDir, "finma-vvtr-sample.xlsx"));
  writeWorkbook(sroRows(), "sro", join(outDir, "finma-sro-sample.xlsx"));
  writeWorkbook(aoRows(), "ao", join(outDir, "finma-ao-sample.xlsx"));
  console.log("Fixtures vvtr, sro et ao écrites.");
}
