import { describe, expect, it } from "vitest";
import { communeResolverFromCsv, loadCommuneResolver } from "../../etl/fosc/communes.js";

const CSV = [
  "postal_code,postal_code_suffix,locality,municipality,municipality_bfs_id,canton,language",
  "1000,0,Lieu A,Exempleville,9001,VD,fr",
  "3000,0,Lieu B,Exempleville,9002,BE,de",
  "1200,0,Lieu C,Uniqueville,9003,GE,fr",
  "1201,0,Lieu D,Uniqueville,9003,GE,fr",
].join("\n");

describe("siège → commune (rapprochement exact seulement)", () => {
  const resolve = communeResolverFromCsv(CSV, 1);
  it("même nom et même canton", () => {
    expect(resolve("Exempleville", "BE")).toEqual({ bfs: 9002, canton: "BE" });
    expect(resolve(" Exempleville ", "VD")).toEqual({ bfs: 9001, canton: "VD" });
  });
  it("nom unique en Suisse : le canton du siège l'emporte sur celui de l'avis (transfert de siège)", () => {
    expect(resolve("Uniqueville", "ZH")).toEqual({ bfs: 9003, canton: "GE" });
  });
  it("nom ambigu hors du canton de l'avis, nom inconnu ou approché : rien", () => {
    expect(resolve("Exempleville", "ZH")).toBeNull();
    expect(resolve("Uniquevile", "GE")).toBeNull();
    expect(resolve("uniqueville", "GE")).toBeNull();
    expect(resolve(null, "GE")).toBeNull();
  });
  it("le répertoire officiel servi suffit à rapprocher les communes à suffixe cantonal", () => {
    const real = loadCommuneResolver();
    expect(real("Aarau", "ZH")).toEqual({ bfs: 4001, canton: "AG" });
    expect(real("Buchs (AG)", "AG")?.canton).toBe("AG");
  });
});
