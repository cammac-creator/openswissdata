import { describe, expect, it } from "vitest";
import { TtlCache } from "../../src/mcp/company/cache.js";

describe("TtlCache", () => {
  it("évince la plus ancienne entrée au-delà de `max`", () => {
    let horloge = 0;
    const cache = new TtlCache<string>({ max: 2, ttlMs: 10_000, now: () => horloge });
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C"); // dépasse max=2 : "a" doit partir
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("B");
    expect(cache.get("c")).toBe("C");
  });

  it("une mise à jour d'une clé déjà présente ne compte pas comme un ajout", () => {
    let horloge = 0;
    const cache = new TtlCache<string>({ max: 2, ttlMs: 10_000, now: () => horloge });
    cache.set("a", "A1");
    cache.set("b", "B");
    cache.set("a", "A2"); // mise à jour, pas un ajout : ne doit pas évincer "b"
    expect(cache.get("a")).toBe("A2");
    expect(cache.get("b")).toBe("B");
  });

  it("rend une valeur figée : la mutation de la valeur rendue n'atteint jamais le cache", () => {
    let horloge = 0;
    const cache = new TtlCache<{ legal_name: string; other_names: string[] }>({ max: 10, ttlMs: 10_000, now: () => horloge });
    const original = { legal_name: "AXA Leben AG", other_names: ["AXA Vie SA"] };
    cache.set("CHE-103.137.179", original);

    const lu = cache.get("CHE-103.137.179")!;
    expect(Object.isFrozen(lu)).toBe(true);
    expect(Object.isFrozen(lu.other_names)).toBe(true); // figé en profondeur, pas seulement en surface
    expect(() => {
      (lu as { legal_name: string }).legal_name = "modifié";
    }).toThrow();
    expect(() => lu.other_names.push("injecté")).toThrow();

    // Même en mutant l'objet passé à `set` après coup (clone à l'écriture), le cache ne bouge pas.
    original.legal_name = "modifié avant écriture";
    expect(cache.get("CHE-103.137.179")!.legal_name).toBe("AXA Leben AG");
  });
});
