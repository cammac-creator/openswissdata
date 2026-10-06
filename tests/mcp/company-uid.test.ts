import { describe, expect, it } from "vitest";
import { parseUid } from "../../src/mcp/company/uid.js";

describe("numéro IDE", () => {
  it.each(["CHE-103.137.179", "CHE103137179", "che 103 137 179", "103.137.179"])("accepte %s", (raw) => {
    expect(parseUid(raw)).toEqual({ ok: true, uid: "CHE-103.137.179", compact: "CHE103137179" });
  });
  it("refuse un chiffre de contrôle faux", () => {
    expect(parseUid("CHE-103.137.178")).toMatchObject({ ok: false });
  });
  it.each(["", "CHE-123", "CHE-103.137.1790", "ABC-103.137.179", "CHE-103.137.17X"])("refuse %s", (raw) => {
    expect(parseUid(raw).ok).toBe(false);
  });
  it("refuse un reste 10 (pas de chiffre de contrôle possible)", () => {
    // 0,0,0,6,0,0,0,0 : 6 × 2 = 12, 12 mod 11 = 1 → 11 − 1 = 10 : aucun chiffre de contrôle possible.
    expect(parseUid("CHE-000.600.000").ok).toBe(false);
    expect(parseUid("CHE-000.600.001").ok).toBe(false);
  });
  it("accepte un reste 11 (chiffre de contrôle 0)", () => {
    // 0,0,0,0,0,0,0,0 : somme 0, 11 − 0 = 11 → 0.
    expect(parseUid("CHE-000.000.000").ok).toBe(true);
  });

  // Suffixe TVA (relecture finale du 06.10.2026) : accepté et retiré, avec ou sans espace,
  // dans les trois langues nationales utilisées pour ce suffixe.
  it.each([
    "CHE-103.137.179 MWST",
    "CHE-103.137.179MWST",
    "CHE-103.137.179 TVA",
    "CHE-103.137.179TVA",
    "CHE-103.137.179 IVA",
    "CHE-103.137.179IVA",
    "che 103 137 179 mwst",
  ])("accepte le suffixe TVA %s", (raw) => {
    expect(parseUid(raw)).toEqual({ ok: true, uid: "CHE-103.137.179", compact: "CHE103137179" });
  });
});
