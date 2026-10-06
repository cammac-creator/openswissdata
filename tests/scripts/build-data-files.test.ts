import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// La construction copie les données servies de src/mcp/data vers dist/mcp/data. Chaque fichier
// de données qui n'est pas un CSV doit y être nommé, sinon il manque en production sans erreur
// (cas réel du 06.10.2026 : localities.meta.json absent, édition du répertoire non affichée).
describe("construction : fichiers de données copiés vers dist", () => {
  it("chaque fichier non CSV de src/mcp/data (hors dossier embeddings) est copié par le script build", () => {
    const build = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> }).scripts.build;
    const autres = readdirSync(new URL("../../src/mcp/data/", import.meta.url), { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith(".") && !e.name.endsWith(".csv")) // fichiers cachés du système (.DS_Store) ignorés
      .map((e) => e.name);
    expect(autres).toContain("localities.meta.json");
    for (const name of autres) expect(build, name).toContain(`src/mcp/data/${name}`);
  });
});
