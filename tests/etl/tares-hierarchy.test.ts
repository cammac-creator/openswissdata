import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import xlsx from "../../etl/shared/xlsx.js";
import { buildTaresPaths, pathDesignations, readStructureLines, type StructureLine } from "../../etl/tares/hierarchy.js";

/** Ligne de structure fictive ; mêmes textes dans les quatre langues sauf précision. */
function line(type: StructureLine["type"], code: string | null, indent: number, fr: string, de = fr): StructureLine {
  return { type, code, indent, text: { fr, de, it: fr, en: fr } };
}

// Extrait fidèle de la structure officielle (chapitre 9 et chapitre 28), textes raccourcis.
const COFFEE: StructureLine[] = [
  line("TAB", "02", 0, "PRODUITS DU RÈGNE VÉGÉTAL"),
  line("TN2", "09", 0, "Café, thé, maté et épices"),
  line("TN4", "0901", 0, "Café, même torréfié ou décaféiné; succédanés du café", "Kaffee, auch geröstet oder entkoffeiniert"),
  line("VT6", null, 1, "café non torréfié", "Kaffee, nicht geröstet"),
  line("TN8", "09011100", 2, "non décaféiné", "nicht entkoffeiniert"),
  line("TN8", "09011200", 2, "décaféiné", "entkoffeiniert"),
  line("VT6", null, 1, "café torréfié", "Kaffee, geröstet"),
  line("TN8", "09012100", 2, "non décaféiné", "nicht entkoffeiniert"),
  line("TN8", "09012200", 2, "décaféiné", "entkoffeiniert"),
  line("TN6", "090190", 1, "autres"),
  line("VT8", null, 2, "coques et pellicules de café"),
  line("TN8", "09019011", 3, "pour l'alimentation des animaux"),
  line("TN8", "09019019", 3, "autres"),
  line("TN8", "09019020", 2, "succédanés du café contenant du café"),
  line("TN4", "0902", 0, "Thé, même aromatisé"),
  line("TN8", "09021000", 1, "thé vert"),
  line("TN8", "09030000", 0, "Maté"),
  line("TN4", "0904", 0, "Poivre"),
  line("VT6", null, 1, "poivre"),
  line("TN8", "09041100", 2, "non broyé ni pulvérisé"),
  line("TAB", "06", 0, "PRODUITS DES INDUSTRIES CHIMIQUES"),
  line("TN2", "28", 0, "Produits chimiques inorganiques"),
  line("TUK", "01", 0, "I. Éléments chimiques"),
  line("TN4", "2805", 0, "Métaux alcalins ou alcalino-terreux"),
  line("VT6", null, 1, "métaux alcalins ou alcalino-terreux"),
  line("TN8", "28051200", 2, "calcium"),
  line("TUK", "02", 0, "II. Acides inorganiques"),
  line("TN4", "2806", 0, "Chlorure d'hydrogène (acide chlorhydrique)"),
  line("TN8", "28061000", 1, "chlorure d'hydrogène (acide chlorhydrique)"),
];

describe("hiérarchie TARES", () => {
  const paths = buildTaresPaths(COFFEE);

  it("rattache chaque ligne à 8 chiffres à ses textes intermédiaires non numérotés", () => {
    expect(pathDesignations(paths.get("09012100")!, "fr")).toEqual(["Café, même torréfié ou décaféiné; succédanés du café", "café torréfié", "non décaféiné"]);
    expect(pathDesignations(paths.get("09011100")!, "fr")).toEqual(["Café, même torréfié ou décaféiné; succédanés du café", "café non torréfié", "non décaféiné"]);
    expect(pathDesignations(paths.get("09012100")!, "de").join(" › ")).toBe("Kaffee, auch geröstet oder entkoffeiniert › Kaffee, geröstet › nicht entkoffeiniert");
  });

  it("dépile par retrait : une sous-position numérotée et un texte VT8 précèdent la ligne", () => {
    expect(pathDesignations(paths.get("09019011")!, "fr").slice(1)).toEqual(["autres", "coques et pellicules de café", "pour l'alimentation des animaux"]);
    // Retrait 2 : le texte VT8 (retrait 2) ne s'applique plus à la ligne suivante de même retrait.
    expect(pathDesignations(paths.get("09019020")!, "fr").slice(1)).toEqual(["autres", "succédanés du café contenant du café"]);
  });

  it("une ligne sans position est sa propre position, la position précédente ne déborde pas", () => {
    const mate = paths.get("09030000")!;
    expect(mate.heading).toBeNull();
    expect(mate.steps).toEqual([]);
    expect(pathDesignations(mate, "fr")).toEqual(["Maté"]);
    expect(pathDesignations(paths.get("09041100")!, "fr")).toEqual(["Poivre", "poivre", "non broyé ni pulvérisé"]);
  });

  it("un sous-chapitre ne remplace ni le chapitre ni les positions suivantes", () => {
    const calcium = paths.get("28051200")!;
    expect(calcium.chapter?.code).toBe("28");
    expect(pathDesignations(calcium, "fr", { chapter: true })).toEqual(["Produits chimiques inorganiques", "Métaux alcalins ou alcalino-terreux", "métaux alcalins ou alcalino-terreux", "calcium"]);
    expect(paths.get("28061000")!.heading?.code).toBe("2806");
    expect(paths.size).toBe(COFFEE.filter((l) => l.type === "TN8").length);
  });

  it("refuse une structure incohérente plutôt que de rattacher une ligne au mauvais parent", () => {
    expect(() => buildTaresPaths([line("TN2", "09", 0, "Café"), line("TN4", "0901", 0, "Café"), line("TN8", "09021000", 1, "thé vert")])).toThrow(/sans sa position/);
    expect(() => buildTaresPaths([line("TN2", "09", 0, "Café"), line("TN4", "0901", 0, "Café"), line("TN8", "09012100", 1, "a"), line("TN8", "09012100", 1, "b")])).toThrow(/en double/);
    expect(() => buildTaresPaths([line("TN2", "09", 0, "Café"), line("TN4", "0901", 0, "Café"), line("TN6", "090290", 1, "autres"), line("TN8", "09019000", 2, "x")])).toThrow(/incohérent/);
    expect(() => buildTaresPaths([line("TN2", "09", 0, "Café"), line("TN4", "8501", 0, "Moteurs")])).toThrow(/hors de son chapitre/);
  });

  it("retire les césures conditionnelles et les espaces doubles des désignations", () => {
    const soft = buildTaresPaths([line("TN2", "84", 0, "Machines"), line("TN4", "8471", 0, "Machines auto­matiques  de traitement"), line("TN8", "84713000", 1, "portables")]);
    expect(pathDesignations(soft.get("84713000")!, "fr")[0]).toBe("Machines automatiques de traitement");
  });
});

describe("lecture du fichier Tarifstruktur", () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

  function workbook(rows: unknown[][]): string {
    dir = mkdtempSync(join(tmpdir(), "osd-struct-"));
    const path = join(dir, "Tarifstruktur.xlsx");
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows), "Struktur_01.03.2025");
    xlsx.writeFile(book, path);
    return path;
  }
  const HEADER = ["Typ", "Numm", "Einrueck", null, "Text D", "Text F", "Text I", "Text E", 2024, "Stand"];

  it("conserve les textes intermédiaires sans numéro et normalise les codes", () => {
    const path = workbook([
      HEADER,
      ["TN2", "09", null, "", "Kaffee", "Café", "Caffè", "Coffee"],
      ["TN4", "0901", null, "", "Kaffee", "Café", "Caffè", "Coffee"],
      ["VT6", null, 1, "-", "Kaffee, geröstet", "café torréfié", "caffè torrefatto", "coffee, roasted"],
      ["TN8", "0901.2100", 2, "- -", "nicht entkoffeiniert", "non décaféiné", "non decaffeinizzato", "not decaffeinated"],
      [null, null, null, null, null, null, null, null],
    ]);
    const lines = readStructureLines(path);
    expect(lines.map((l) => [l.type, l.code, l.indent])).toEqual([["TN2", "09", 0], ["TN4", "0901", 0], ["VT6", null, 1], ["TN8", "09012100", 2]]);
    expect(lines[2].text).toEqual({ fr: "café torréfié", de: "Kaffee, geröstet", it: "caffè torrefatto", en: "coffee, roasted" });
  });

  it("refuse un type de ligne inconnu ou une ligne de texte sans type", () => {
    expect(() => readStructureLines(workbook([HEADER, ["TN9", "01", null, "", "x", "x", "x", "x"]]))).toThrow(/type inconnu/);
    rmSync(dir!, { recursive: true, force: true });
    expect(() => readStructureLines(workbook([HEADER, [null, null, 1, "-", "x", "x", "x", "x"]]))).toThrow(/sans type/);
  });
});
