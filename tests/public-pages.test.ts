import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { jsonForHtml } from "../web/src/lib/html";

describe("Données intégrées aux pages publiques", () => {
  it("conserve le texte sans permettre de fermer une balise JSON-LD", () => {
    const value = { name: '</script><img src=x onerror="alert(1)">', accents: "é & < >" };
    const encoded = jsonForHtml(value);
    expect(encoded).not.toContain("<");
    expect(JSON.parse(encoded)).toEqual(value);
  });

  it("utilise la référence sourcée et refuse le chaînage de deux approximations", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(resolve("web"));
    let helpers;
    try { helpers = await import("../web/src/lib/noga-helpers"); } finally { cwd.mockRestore(); }
    expect(helpers.loadNoga2025()).toHaveLength(1845);
    expect(helpers.getClassificationReferenceVersion()).toBe("2026.09.25");
    const rows = helpers.getCrosswalksFor("1811");
    expect(rows).toContainEqual(expect.objectContaining({ standard: "NACE 2.1", code: "1811", relation: "exactMatch", requires_review: false }));
    expect(rows).toContainEqual(expect.objectContaining({ standard: "NACE 2.0", code: "1811", relation: "closeMatch", requires_review: true }));
    expect(rows.some(r => r.standard === "ISIC 4")).toBe(false);
    expect(rows.every(r => r.sources.length > 0 && r.sources.every(s => s.version === "2026.09.25"))).toBe(true);
  });
});
