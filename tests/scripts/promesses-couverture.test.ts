import { describe, it, expect } from "vitest";
import { couvertureTenue } from "../../scripts/promesses/couverture.mjs";

// Décision d6 de Claude-Alain (16.10.2026) : la promesse finma-historique suit la fenêtre glissante au lieu
// d'un seuil fixe de 61 versions, rouge à tort depuis le 13.10 (60 versions servies, aucune perte).
// Valeurs servies le 16.10.2026 : du 2026-07-17 au 2026-10-16, 60 versions, un trou de 32 jours.
const REGLE = { tolerance_jours: 3, fenetre_min_jours: 85, trous_connus: [{ from: "2026.08.24", to: "2026.09.25" }] };
const SERVI = {
  available_from: "2026-07-17",
  available_until: "2026-10-16",
  snapshots: 60,
  gaps: [{ from: "2026.08.24", to: "2026.09.25", days: 32 }],
};

describe("couvertureTenue : historique FINMA à fenêtre glissante", () => {
  it("tient avec les valeurs servies le 16.10.2026", () => {
    expect(couvertureTenue(SERVI, REGLE)).toEqual({ ok: true, detail: "60 versions pour 58 attendues" });
  });

  it("rougit quand des versions disparaissent sans trou déclaré", () => {
    const r = couvertureTenue({ ...SERVI, snapshots: 57 }, REGLE);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("57 versions pour 58 attendues");
  });

  it("rougit quand l'historique raccourcit (ce que le seuil fixe attrapait)", () => {
    const r = couvertureTenue({ ...SERVI, available_from: "2026-09-25", snapshots: 22, gaps: [] }, REGLE);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("fenêtre de 21 jours");
  });

  it("tient quand le début de la fenêtre tombe dans le trou (version d'avant le trou gardée par la collecte)", () => {
    // 30.11 : la collecte garde la dernière version avant la limite des 90 jours, le 24.08.
    const r = couvertureTenue({ available_from: "2026-08-24", available_until: "2026-11-30", snapshots: 68, gaps: SERVI.gaps }, REGLE);
    expect(r.ok).toBe(true);
  });

  it("rougit sur un nouveau trou, même quand le trou connu est sorti de la fenêtre (relecture du 16.10.2026)", () => {
    // 14.02.2027 : nouveau trou de 41 jours, 52 versions sur 91 jours ; l'ancien seuil fixe rougissait aussi.
    const r = couvertureTenue({ available_from: "2026-11-15", available_until: "2027-02-14", snapshots: 52, gaps: [{ from: "2026.12.10", to: "2027.01.20", days: 41 }] }, REGLE);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("52 versions pour 89 attendues");
    // Un nouveau trou dans la fenêtre du trou connu n'est pas excusé non plus.
    expect(couvertureTenue({ ...SERVI, snapshots: 55, gaps: [...SERVI.gaps, { from: "2026.10.05", to: "2026.10.11", days: 6 }] }, REGLE).ok).toBe(false);
  });

  it("refuse une donnée illisible ou une règle mal écrite", () => {
    expect(couvertureTenue(undefined, REGLE).ok).toBe(false);
    expect(couvertureTenue({ ...SERVI, gaps: [{ days: "32" }] }, REGLE).ok).toBe(false);
    expect(couvertureTenue({ ...SERVI, available_until: "pas une date" }, REGLE).ok).toBe(false);
    expect(couvertureTenue(SERVI, { tolerance_jours: -1, fenetre_min_jours: 85 }).ok).toBe(false);
    expect(couvertureTenue(SERVI, undefined).ok).toBe(false);
    expect(couvertureTenue(SERVI, { tolerance_jours: 3, fenetre_min_jours: 85 }).ok).toBe(false);   // trous connus absents
    expect(couvertureTenue(SERVI, { ...REGLE, trous_connus: [{ from: "pas une date", to: "2026.09.25" }] }).ok).toBe(false);
  });
});
