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
  it("l'index des personnes, gardé en mémoire pour le contrôle, n'est jamais écrit", () => {
    expect(written).not.toContain("personIndex");
  });
  it("un élément vide ou mal placé ne fait pas entrer un texte qui n'est pas un nom", () => {
    const base = (inner: string, id: string) =>
      `<target ssid="${id}"><entity><identity ssid="9" main="true"><name ssid="8" name-type="primary-name"><name-part order="1" name-part-type="whole-name"><value>Org ${id}</value></name-part></name>${inner}</identity></entity><modification modification-type="listed"/><sanctions-set-id>4387</sanctions-set-id></target>`;
    const doc = (body: string) => `<swiss-sanctions-list list-type="whole-list" date="2026-11-04"><sanctions-program ssid="20"><program-key lang="eng">Exampleland</program-key><sanctions-set ssid="4387" lang="eng">x</sanctions-set><origin>EU</origin></sanctions-program>${body}</swiss-sanctions-list>`;
    const relation = `<relation ssid="7" relation-type="related-to" target-id="1"><name name-type="alias"><name-part order="1"><value>TEMOIN-FUITE</value></name-part></name></relation>`;
    const cases = [
      // Nom auto-fermé, puis `relation/name` dans la même entrée.
      doc(base(`<name ssid="1" name-type="alias"/>${relation}`, "1")),
      // Partie de nom auto-fermée, puis texte de relation.
      doc(`<target ssid="1"><entity><identity ssid="9" main="true"><name ssid="8" name-type="primary-name"><name-part order="1" name-part-type="whole-name"><value>Org 1</value></name-part><name-part order="2"/><relation ssid="7" target-id="1"><value>TEMOIN-FUITE</value></relation></name></identity></entity><modification modification-type="listed"/><sanctions-set-id>4387</sanctions-set-id></target>`),
      // Nom auto-fermé en première entrée, relation dans la suivante.
      doc(base(`<name ssid="1" name-type="alias"/>`, "1") + base(relation, "2")),
      // Un nom hors de `identity`.
      doc(`<target ssid="1"><entity><identity ssid="9" main="true"><name ssid="8" name-type="primary-name"><name-part order="1"><value>Org 1</value></name-part></name></identity><other-information ssid="6"><name name-type="alias"><name-part order="1"><value>TEMOIN-FUITE</value></name-part></name></other-information></entity><modification modification-type="listed"/><sanctions-set-id>4387</sanctions-set-id></target>`),
    ];
    for (const body of cases) {
      const out = JSON.stringify(parseSesamXml(body).entries);
      expect(out).not.toContain("TEMOIN");
      expect(out).toContain("Org 1");
    }
  });
  it("un fragment du nom d'une personne, sans le nom entier, ne sort pas", () => {
    const text = JSON.stringify(doc.entries.filter((e) => e.kind === "organisation"));
    expect(xml).toContain("Pavlo Ivanovich Temoinchuk");
    expect(text).not.toContain("Temoinchuk");
  });
  it("la preuve par comptage", () => {
    expect(doc.counts).toEqual({ organisations: 2, vessels: 1 });
    expect(doc.exclusion_proof).toEqual({
      source_entries: { natural_persons: 2, organisations: 4, vessels: 2 },
      excluded: { natural_persons: 2, delisted_organisations: 1, delisted_vessels: 1, organisations_primary_name_carries_person: 1 },
      organisation_names_removed_carrying_person: 4,
      vessels_name_equals_person_entry: 1,
      organisation_names_honouring_a_person_kept: 1,
      organisation_names_kept_after_review: 0,
      natural_persons_served: 0,
      relations_served: 0,
      free_text_fields_served: 0,
      organisation_names_caught_by_person_rule_served: 0,
    });
  });
});
