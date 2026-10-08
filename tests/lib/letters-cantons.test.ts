import { describe, it, expect } from "vitest";
import { isAllowedRecipient } from "../../src/lib/letters.js";

// Domaines cantonaux des lettres institutionnelles (décision de Claude-Alain du 08.10.2026, plan
// « demandes aux distributeurs ») : seulement les domaines qu'un canton utilise réellement dans ses
// points de contact sur opendata.swiss ET vérifiés sur son site officiel. Tout le reste reste refusé.

describe("isAllowedRecipient : administrations cantonales", () => {
  it("accepte les domaines cantonaux vérifiés et leurs sous-domaines", () => {
    for (const address of [
      "boite-fictive@zh.ch",
      "boite-fictive@statistik.zh.ch",
      "boite-fictive@bd.zh.ch",
      "boite-fictive@etat.ge.ch",
      "boite-fictive@lustat.ch",
      "boite-fictive@bl.ch",
      "boite-fictive@jura.ch",
      "boite-fictive@admin.vs.ch",
      "boite-fictive@bd.so.ch",
      "boite-fictive@ti.ch",
    ]) {
      expect(isAllowedRecipient(address), address).toBe(true);
    }
  });

  it("refuse les imitations d'un domaine cantonal", () => {
    for (const address of [
      "boite-fictive@zh.ch.example.com",
      "boite-fictive@xzh.ch",
      "boite-fictive@notlustat.ch",
      "boite-fictive@lustat.ch.evil.org",
      "boite-fictive@ge.ch.",
      "boite-fictive@.ge.ch",
    ]) {
      expect(isAllowedRecipient(address), address).toBe(false);
    }
  });

  it("refuse les domaines non retenus : non vus dans le catalogue, communes, entreprises, instituts", () => {
    for (const address of [
      "boite-fictive@ju.ch", // redirige vers jura.ch, mais aucun point de contact ne l'utilise
      "boite-fictive@baselland.ch", // site du canton, mais les contacts utilisent bl.ch
      "boite-fictive@vd.ch", // jamais vu dans les points de contact au 08.10.2026
      "boite-fictive@ne.ch",
      "boite-fictive@riehen.ch", // commune
      "boite-fictive@stadt-zuerich.ch", // commune
      "boite-fictive@tpg.ch", // entreprise publique
      "boite-fictive@wsl.ch", // institut de recherche (second lot)
      "boite-fictive@energiefranken.ch",
    ]) {
      expect(isAllowedRecipient(address), address).toBe(false);
    }
  });
});
