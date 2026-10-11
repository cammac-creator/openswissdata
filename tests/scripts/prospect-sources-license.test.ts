import { describe, it, expect } from "vitest";
import { classifyLicence, classifyPackage } from "../../scripts/prospect-sources.js";

// Relevé le 08.10.2026 (chantier des demandes aux distributeurs officiels) : opendata.swiss porte la
// licence de certaines ressources dans `license` et laisse `rights` vide (jeux de l'OSAV en terms_by,
// de l'OFSP en terms_open). La prospection les classait « licence_absente » et ne les voyait jamais.
// `rights` reste prioritaire ; `license` n'est lu que lorsque `rights` est vide.

const BY = "https://opendata.swiss/terms-of-use#terms_by";
const OPEN = "https://opendata.swiss/terms-of-use#terms_open";
const BY_ASK = "https://opendata.swiss/terms-of-use#terms_by_ask";

describe("classifyLicence : champ `license` quand `rights` est vide", () => {
  it("terms_by ou terms_open dans `license` seulement : ouvert", () => {
    expect(classifyLicence([{ rights: null, license: BY }])).toEqual({ licence: "open", matched: "by" });
    expect(classifyLicence([{ license: OPEN }])).toEqual({ licence: "open", matched: "open" });
  });

  it("`rights` reste prioritaire : terms_by_ask dans `rights` n'est jamais ouvert par `license`", () => {
    expect(classifyLicence([{ rights: BY_ASK, license: BY }])).toEqual({ licence: "exclu", motif: "licence_non_ouverte" });
  });

  it("aucun des deux champs : toujours « licence_absente »", () => {
    expect(classifyLicence([{ rights: null, license: null }])).toEqual({ licence: "exclu", motif: "licence_absente" });
    expect(classifyLicence([{ rights: "", license: "  " }])).toEqual({ licence: "exclu", motif: "licence_absente" });
  });

  it("un jeu OSAV à licence dans `license` devient candidat (sans marqueur de personnes)", () => {
    const verdict = classifyPackage(
      {
        id: "1ff6cf11-0000-0000-0000-000000000000",
        name: "x",
        title: { fr: "Résidus de produits phytosanitaires dans les denrées alimentaires" },
        organization: { name: "osav", title: "OSAV", political_level: "confederation" },
        resources: [{ format: "CSV", url: "https://example.ch/a.csv", rights: null, license: BY }],
      },
      new Set(),
    );
    expect(verdict.licence).toBe("open");
    expect(verdict.licenceCode).toBe("by");
    expect(verdict.isCandidate).toBe(true);
  });
});
