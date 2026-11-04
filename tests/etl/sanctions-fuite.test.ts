/**
 * Test de fuite, lancé par `refresh-sanctions.yml` AVANT toute lecture de la source : un témoin
 * placé dans chaque champ qui ne doit pas sortir (personne, relation, texte libre, adresse,
 * historique, entrée radiée) n'apparaît nulle part dans le document écrit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSanctionsDocument } from "../../etl/sanctions/build.js";
import { parseSesamXml } from "../../etl/sanctions/parse.js";

const xml = readFileSync(new URL("../../etl/sanctions/fixtures/sesam-sample.xml", import.meta.url), "utf8");
const source = { sha256: "a".repeat(64), bytes: xml.length, collectedAt: "2026-11-04T12:00:00.000Z" };

describe("liste des sanctions : aucune fuite vers le document écrit", () => {
  const doc = buildSanctionsDocument(parseSesamXml(xml), source);
  const written = JSON.stringify(doc);

  it("le fichier fictif porte bien les témoins (le test ne passe pas à vide)", () => {
    expect(xml.match(/TEMOIN-/g)?.length).toBeGreaterThan(20);
  });
  it("aucun témoin ne sort", () => {
    expect(written).not.toContain("TEMOIN");
  });
  it("aucun nom de personne ne sort sur une organisation, ni entier ni à l'intérieur d'un nom", () => {
    const organisations = doc.entries.filter((e) => e.kind === "organisation");
    const text = JSON.stringify(organisations);
    expect(text).not.toContain("Pavel");
    expect(text).not.toContain("Temoinov");
    expect(text).not.toContain("Alias Personne");
    expect(text).not.toContain("Haji");
  });
  it("aucune date de naissance, pièce ni nationalité", () => {
    expect(written).not.toContain("1960");
    expect(written).not.toMatch(/passport|nationality|sex/i);
  });
  it("une entrée ne porte que les champs de la liste blanche", () => {
    for (const entry of doc.entries) {
      expect(Object.keys(entry).sort()).toEqual(["countries", "id", "imo", "kind", "listed_on", "names", "programmes"]);
    }
  });
  it("la personne n'existe pas dans le rendu de la lecture, sauf la clé de contrôle jamais écrite", () => {
    expect(written).not.toContain("personNameKeys");
  });
  it("la preuve par comptage", () => {
    expect(doc.counts).toEqual({ organisations: 2, vessels: 1 });
    expect(doc.exclusion_proof).toEqual({
      source_entries: { natural_persons: 1, organisations: 4, vessels: 2 },
      excluded: { natural_persons: 1, delisted_organisations: 1, delisted_vessels: 1, organisations_primary_name_carries_person: 1 },
      organisation_names_removed_carrying_person: 3,
      vessels_name_equals_person_entry: 1,
      organisation_names_honouring_a_person_kept: 1,
      natural_persons_served: 0,
      relations_served: 0,
      free_text_fields_served: 0,
      organisation_names_carrying_person_served: 0,
    });
  });
});
