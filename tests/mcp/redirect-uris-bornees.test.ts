// Migration zod 4 (24.10.2026), avis GHSA-mrhx-c7xc-m3w5 : avant zod 4.6.6, un tableau trop long était
// quand même validé élément par élément, et chaque élément refusé ajoutait un objet d'erreur (mémoire
// sans plafond). Depuis 4.6.6, un tableau qui dépasse son `.max()` est refusé d'un seul coup.
// Ce test le prouve sur la liste publique des destinations OAuth (inscription sans authentification).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RedirectUrisSchema } from "../../src/mcp/oauth/redirects.js";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";

const URI = "https://client.example.test/callback";

describe("Destinations OAuth : liste bornée sous zod 4", () => {
  it("zod installé est corrigé de l'avis (version 4.6.6 ou plus)", () => {
    const { version } = createRequire(import.meta.url)("zod/package.json") as { version: string };
    const [major, minor, patch] = version.split(".").map(part => Number.parseInt(part, 10));
    expect(major).toBe(4);
    expect(minor > 6 || (minor === 6 && patch >= 6)).toBe(true);
  });

  it("refuse un million d'éléments invalides par une seule erreur, sans valider les éléments", () => {
    const result = RedirectUrisSchema.safeParse(Array(1_000_000).fill(123));
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({ code: "too_big", maximum: 10, path: [] });
  });

  it("refuse onze destinations valides par une seule erreur de longueur", () => {
    const result = RedirectUrisSchema.safeParse(Array.from({ length: 11 }, (_, i) => `${URI}${i}`));
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.code).toBe("too_big");
  });

  it("garde les refus d'avant : doublon, élément invalide, liste vide", () => {
    expect(RedirectUrisSchema.safeParse([URI, URI]).success).toBe(false);
    expect(RedirectUrisSchema.safeParse([URI, "javascript:alert(1)"]).success).toBe(false);
    expect(RedirectUrisSchema.safeParse([]).success).toBe(false);
    expect(RedirectUrisSchema.parse([URI, `${URI}2`])).toEqual([URI, `${URI}2`]);
  });
});

describe("Inscription OAuth : code d'erreur d'une liste trop longue", () => {
  let folder: string;
  beforeEach(() => {
    closeDb();
    folder = mkdtempSync(join(tmpdir(), "osd-destinations-bornees-"));
    vi.stubEnv("DATABASE_PATH", join(folder, "fictive.sqlite"));
    vi.stubEnv("OAUTH_SIGNING_SECRET", "cle-fictive-destinations-assez-longue");
  });
  afterEach(() => { closeDb(); vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true }); });

  it.each([
    ["onze destinations valides", Array.from({ length: 11 }, (_, i) => `${URI}${i}`)],
    ["cinq mille éléments invalides, sous le plafond de 16 Kio", Array(5_000).fill(1)],
  ])("répond invalid_redirect_uri pour %s, sans créer d'application", async (_label, redirect_uris) => {
    const body = JSON.stringify({ name: "Application fictive", email: "fictive@example.test", redirect_uris });
    expect(Buffer.byteLength(body)).toBeLessThan(16_384);
    const r = await createApp().request("/mcp/oauth/register", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_redirect_uri" });
    expect(getDb().prepare("SELECT COUNT(*) n FROM mcp_clients").get()).toEqual({ n: 0 });
  });
});
