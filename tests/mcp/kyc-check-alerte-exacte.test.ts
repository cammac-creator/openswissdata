/**
 * tâche osd.S10 : kyc_check ne doit déclencher la ligne « WARNING » de la liste d'alerte FINMA
 * que sur un nom identique (rang "exact" de name-match.ts, après repliement des accents et de la
 * casse). Un nom seulement proche reste visible, mais à part et sans jamais dire « WARNING » ni
 * « match ». Un nom absent de la liste ne produit aucune des deux mentions.
 *
 * Noms fictifs uniquement (aucun vrai nom d'entreprise de la liste d'alerte, règle du projet).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kycCheckHandler } from "../../src/mcp/tools/kyc-check.js";
import {
  _resetDataLoaderCache,
  setFinmaRegistry,
  setFinmaWarnings,
  type FinmaRegistryRow,
  type FinmaWarningRow,
} from "../../src/mcp/data-loader.js";

function entity(name: string, uid = ""): FinmaRegistryRow {
  return {
    entity_type: "bank",
    name,
    uid,
    lei: "",
    licence_type: "Bank",
    licence_type_de: "Bank",
    licence_type_fr: "Banque",
    licence_type_it: "Banca",
    licence_date: "",
    status: "",
    canton: "",
    city: "Exempleville",
    address: "",
    source_list: "fictif",
    source_url: "https://www.finma.ch/",
    is_warning_listed: "false",
  };
}

function warning(name: string): FinmaWarningRow {
  return {
    name,
    country: "",
    date_added: "2026-01-01",
    category: "fictif",
    source_url: "https://www.finma.ch/",
    source_list: "fictif",
    warning_type: "unauthorized_provider",
    additional_info: "",
  };
}

describe("kyc_check : la ligne d'alerte FINMA ne sort que sur un nom identique", () => {
  beforeEach(() => {
    _resetDataLoaderCache();
    setFinmaRegistry([entity("Exemple Fiducié SA", "CHE-000.000.001")]);
    setFinmaWarnings([warning("Fiducié Alerta SA"), warning("Alerta Invest Group")]);
  });
  afterEach(() => _resetDataLoaderCache());

  it("nom identique (après repliement des accents et de la casse) : déclenche WARNING", () => {
    const out = kycCheckHandler({ name: "fiducie alerta sa", top_k: 10 });
    expect(out.structured?.warning_total).toBe(1);
    expect(out.content[0].text).toContain("WARNING: 1 FINMA warning entry/entries match");
    expect(out.content[0].text).toContain("Fiducié Alerta SA");
    // La seconde entrée de la liste d'alerte ne partage qu'un mot : elle ne doit pas apparaître
    // comme un nom identique dans cette réponse ciblée sur "fiducie alerta sa".
    expect(out.content[0].text).not.toContain("Alerta Invest Group");
  });

  it("nom qui ne partage qu'un morceau : pas de WARNING, mention « nom proche, à vérifier »", () => {
    const out = kycCheckHandler({ name: "Alerta", top_k: 10 });
    expect(out.structured?.warning_total).toBe(2);
    const text = out.content[0].text;
    expect(text).not.toContain("WARNING");
    expect(text).not.toMatch(/\bmatch\b/i);
    expect(text).toContain("Similar name(s) on the FINMA warnings list, to verify");
    expect(text).toContain("Fiducié Alerta SA");
    expect(text).toContain("Alerta Invest Group");
    expect(text).toContain("rank:");
  });

  it("noms identiques qui remplissent top_k : les noms proches sont comptés, sans titre vide", () => {
    setFinmaWarnings([warning("Alerta Fiduciaire SA"), warning("Alerta Fiduciaire SA Holding")]);
    const out = kycCheckHandler({ name: "alerta fiduciaire sa", top_k: 1 });
    const text = out.content[0].text;
    expect(text).toContain("WARNING: 1 FINMA warning entry/entries match");
    expect(text).toContain("Similar name(s) on the FINMA warnings list, to verify: 1 not shown (raise top_k to list them).");
    expect(text).not.toContain("(closest 0 shown)");
  });

  it("nom absent de la liste d'alerte : ni WARNING, ni nom proche", () => {
    const out = kycCheckHandler({ name: "Introuvable Sàrl", top_k: 10 });
    expect(out.structured?.warning_total).toBe(0);
    const text = out.content[0].text;
    expect(text).not.toContain("WARNING");
    expect(text).not.toContain("Similar name(s) on the FINMA warnings list");
    expect(text).not.toMatch(/\bmatch\b/i);
  });
});
