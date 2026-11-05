import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOUANE_CONCORDANCE_SOURCE, DOUANE_R2_KEY, DOUANE_ZIP_SOURCES } from "../../etl/douane/sources.js";
import { PRODUCT_SOURCES } from "../../etl/shared/sources/products.js";
import { getSource } from "../../etl/shared/sources/registry.js";
import { PERMISSION_PROFILES } from "../../etl/shared/provenance.js";
import { getPublicSource } from "../../src/lib/public-sources.js";

const SOURCES = [...Object.values(DOUANE_ZIP_SOURCES), DOUANE_CONCORDANCE_SOURCE];

describe("registre des sources : commerce extérieur de l'OFDF", () => {
  it.each(SOURCES.map((s) => [s.id, s.url] as const))("%s : au registre, sans canari", (id, url) => {
    const s = getSource(id);
    expect(s.institution).toBe("BAZG");
    expect(s.url).toBe(url);
    expect(s.canary).toBeUndefined();
  });
  it("la licence dit ce qui est affiché et ne prétend à aucun accord", () => {
    for (const { id } of SOURCES) {
      const { licence } = getSource(id);
      expect(licence.authority).toContain("terms_by_ask");
      expect(licence.authority).toContain("No permission requested or held");
      // Une date de permission écrite serait un accord que nous n'avons pas.
      expect(licence.date).toBeUndefined();
      expect(licence.reference).not.toBe(PERMISSION_PROFILES.tares.permissionReference);
    }
  });
  it("n'entre dans aucune archive vendue", () => {
    for (const ids of Object.values(PRODUCT_SOURCES)) for (const { id } of SOURCES) expect(ids).not.toContain(id);
  });
  it("n'apparaît pas dans la liste publique : rien n'est servi à ce jour", () => {
    for (const { id } of SOURCES) expect(getPublicSource(id)).toBeUndefined();
  });
  it("le document vit dans le bucket privé, sous douane/or/, sans date dans la clé", () => {
    expect(DOUANE_R2_KEY.startsWith("douane/or/")).toBe(true);
    expect(DOUANE_R2_KEY).not.toMatch(/\d{4}-\d{2}/);
  });
});

describe("workflow de la collecte", () => {
  const yml = readFileSync(new URL("../../.github/workflows/refresh-douane.yml", import.meta.url), "utf8");
  it("mensuel, minute non ronde", () => {
    const cron = /cron: "(\d+) (\d+) (\d+) \* \*"/.exec(yml);
    expect(cron).not.toBeNull();
    expect(Number(cron?.[1]) % 5).not.toBe(0);
  });
  it("simulation par défaut, secrets R2 seulement à l'étape réelle", () => {
    expect(yml).toMatch(/dry_run:[\s\S]*?default: true/);
    const simulation = yml.slice(yml.indexOf("- name: Simulation"), yml.indexOf("- name: Collecter"));
    expect(simulation).not.toContain("R2_");
  });
  it("ne commite rien et ne crée aucun artefact", () => {
    expect(yml).not.toMatch(/upload-artifact|git commit|git push/);
    expect(yml).toContain("contents: read");
  });
  it("alerte par scripts/alert-email.mjs et lance les tests avant la source", () => {
    expect(yml).toContain("node scripts/alert-email.mjs");
    expect(yml.indexOf("douane-fuite.test.ts")).toBeLessThan(yml.indexOf("npm run sync:douane"));
  });
});
