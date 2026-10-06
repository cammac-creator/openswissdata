/**
 * Accès des agents IA au serveur MCP : négociation de version, notifications, adresses d'entrée,
 * liste des outils par appelant, refus lisibles, limite anonyme fondée sur l'adresse fiable et
 * mesures facultatives (connexions, premiers refus). Bases fictives uniquement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { _resetRateLimit, _bucketCount, checkRateLimit } from "../../src/mcp/rate-limit.js";
import { negotiateProtocolVersion, SUPPORTED_PROTOCOL_VERSIONS } from "../../src/mcp/server.js";
import { tariffLookupHandler } from "../../src/mcp/tools/tariff-lookup.js";
import { kycCheckTool } from "../../src/mcp/tools/kyc-check.js";
import { getTares, _resetDataLoaderCache } from "../../src/mcp/data-loader.js";
import { MCP_BODY_BYTES } from "../../src/mcp/body-limit.js";
import { generateClientId, generateClientSecret, hashToken } from "../../src/mcp/oauth/crypto.js";
import { insertClient, insertToken } from "../../src/mcp/oauth/store.js";
import { TIER_DEFAULT_SCOPES, serializeScopes } from "../../src/mcp/oauth/scopes.js";
import { randomBytes } from "node:crypto";

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

type App = ReturnType<typeof createApp>;
const post = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const events = (name: string) =>
  getDb().prepare("SELECT status, ua_class, meta_json FROM events WHERE kind='custom' AND name=? ORDER BY id").all(name) as
    Array<{ status: number; ua_class: string; meta_json: string }>;

describe("Accès des agents au serveur MCP", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-acces-agents-"));
    vi.stubEnv("DATABASE_PATH", join(tmp, "fictive.sqlite"));
    vi.stubEnv("SESSION_SECRET", "secret-session-fictif-acces-agents");
    vi.stubEnv("OAUTH_SIGNING_SECRET", "secret-oauth-fictif-acces-agents-32");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MCP_BEARER_TOKEN", "");
    getDb();
    _resetRateLimit();
  });

  afterEach(() => {
    closeDb();
    _resetRateLimit();
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("négociation de la version du protocole", () => {
    it("renvoie la version demandée quand elle est servie, sinon la plus récente", () => {
      for (const v of SUPPORTED_PROTOCOL_VERSIONS) expect(negotiateProtocolVersion(v)).toBe(v);
      expect(negotiateProtocolVersion("2099-01-01")).toBe("2025-11-25");
      expect(negotiateProtocolVersion(undefined)).toBe("2025-11-25");
      expect(negotiateProtocolVersion(42)).toBe("2025-11-25");
    });

    it("un client 2025-06-18 reçoit 2025-06-18 et les consignes pour agents", async () => {
      const res = await post(createApp(), "/mcp/jsonrpc", {
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "client-ancien", version: "1.17.5" } },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.protocolVersion).toBe("2025-06-18");
      expect(body.result.instructions).toContain("tariff_lookup");
      expect(body.result.instructions).toContain("100 calls per hour per IP address");
      expect(body.result.instructions).toContain("closed to new subscribers");
    });
  });

  it("les réponses d'initialisation et de liste ne contiennent jamais « data: » (clients qui devinent un flux SSE)", async () => {
    const app = createApp();
    for (const body of [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sonde", version: "1" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]) {
      const text = await (await post(app, "/mcp/jsonrpc", body)).text();
      expect(text).not.toContain("data:");
    }
  });

  describe("notifications et adresses d'entrée", () => {
    it("une notification reçoit 202 sans corps et n'est pas exécutée", async () => {
      const res = await post(createApp(), "/mcp/jsonrpc", { jsonrpc: "2.0", method: "notifications/initialized" });
      expect(res.status).toBe(202);
      expect(await res.text()).toBe("");
    });

    it("un lot de notifications reçoit 202, un lot mixte ne répond qu'aux requêtes", async () => {
      const app = createApp();
      const only = await post(app, "/mcp/jsonrpc", [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
      ]);
      expect(only.status).toBe(202);
      const mixed = await post(app, "/mcp/jsonrpc", [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: "p", method: "ping" },
      ]);
      const replies = await mixed.json();
      expect(replies).toEqual([{ jsonrpc: "2.0", id: "p", result: {} }]);
    });

    it("un appel d'outil sans id n'est ni exécuté ni mesuré", async () => {
      const handler = vi.spyOn(kycCheckTool, "handler");
      const res = await post(createApp(), "/mcp/jsonrpc", {
        jsonrpc: "2.0", method: "tools/call", params: { name: "kyc_check", arguments: { name: "Institution fictive" } },
      });
      expect(res.status).toBe(202);
      expect(handler).not.toHaveBeenCalled();
      await flush();
      expect(events("mcp_tool_call")).toHaveLength(0);
      handler.mockRestore();
    });

    it("un lot vide est une requête invalide", async () => {
      const res = await post(createApp(), "/mcp/jsonrpc", []);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe(-32600);
    });

    it("GET sur le point d'entrée répond 405 avec Allow: POST", async () => {
      const res = await createApp().request("/mcp/jsonrpc");
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    });

    it("l'ouverture d'un flux SSE sur une adresse d'entrée répond 405, sur les deux hôtes", async () => {
      const app = createApp();
      const sse = { accept: "text/event-stream" };
      for (const [path, host] of [["/", "mcp.openswissdata.com"], ["/mcp", "mcp.openswissdata.com"], ["/jsonrpc", "mcp.openswissdata.com"], ["/mcp", "www.openswissdata.com"], ["/mcp/", "www.openswissdata.com"], ["/mcp/jsonrpc", "www.openswissdata.com"]]) {
        const res = await app.request(`http://${host}${path}`, { headers: { ...sse, host } });
        expect(res.status, `${host}${path}`).toBe(405);
      }
    });

    it("un navigateur sur la racine du sous-domaine est toujours renvoyé vers la documentation", async () => {
      const res = await createApp().request("http://mcp.openswissdata.com/", {
        headers: { host: "mcp.openswissdata.com", accept: "text/html,application/xhtml+xml" },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://www.openswissdata.com/mcp");
    });

    it("POST sur la racine du sous-domaine, sur /mcp et sur /mcp/ atteint le même JSON-RPC", async () => {
      const app = createApp();
      const ping = { jsonrpc: "2.0", id: 7, method: "ping" };
      const targets: Array<[string, string]> = [
        ["http://mcp.openswissdata.com/", "mcp.openswissdata.com"],
        ["http://mcp.openswissdata.com/mcp", "mcp.openswissdata.com"],
        ["http://www.openswissdata.com/mcp", "www.openswissdata.com"],
        ["http://www.openswissdata.com/mcp/", "www.openswissdata.com"],
      ];
      for (const [url, host] of targets) {
        const res = await post(app, url, ping, { host });
        expect(res.status, url).toBe(200);
        expect(await res.json(), url).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
      }
    });
  });

  describe("outils présentés et refus", () => {
    it("un appelant anonyme ne voit que les quatre outils gratuits et les trois de l'essai, annotés en lecture seule (sauf company_check, qui interroge le monde extérieur en direct)", async () => {
      const res = await post(createApp(), "/mcp/jsonrpc", { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const tools = (await res.json()).result.tools as Array<{ name: string; title: string; annotations: Record<string, unknown> }>;
      // Essai des outils de recherche (29.09.2026) ; l'historique reste réservé aux jetons.
      // company_check ouvert sans clé le 06.10.2026 (« go fiche », DECISIONS.md).
      expect(tools.map((t) => t.name)).toEqual(["tariff_lookup", "kyc_check", "company_check", "cross_walk", "tariff_semantic_search", "classify_text", "finma_search"]);
      for (const t of tools) {
        expect(t.title.length).toBeGreaterThan(5);
        const openWorldHint = t.name === "company_check"; // seul outil à lire deux sources tierces en direct
        expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint });
      }
    });

    it("la découverte anonyme annonce l'accès gratuit et la documentation", async () => {
      const body = await (await createApp().request("/mcp/discovery")).json();
      expect(body.tools).toEqual(["tariff_lookup", "kyc_check", "company_check", "cross_walk", "tariff_semantic_search", "classify_text", "finma_search"]);
      expect(body.anonymous_access.tools).toEqual(["tariff_lookup", "kyc_check", "company_check", "cross_walk"]);
      expect(body.anonymous_access.limit).toBe("100 calls per hour per IP address");
      expect(body.supported_protocol_versions).toContain("2025-06-18");
      expect(body.documentation).toMatch(/\/llms\.txt$/);
    });

    it("un outil Pro appelé sans jeton donne un résultat lisible, pas une erreur de protocole", async () => {
      const res = await post(createApp(), "/mcp/jsonrpc", {
        jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "entity_history", arguments: { uid: "CHE-000.000.000" } },
      });
      const body = await res.json();
      expect(body.error).toBeUndefined();
      expect(body.result.isError).toBe(true);
      const text = body.result.content[0].text as string;
      expect(text).toContain("closed to new subscribers");
      expect(text).toContain("cross_walk");
      expect(text).not.toMatch(/upgrade/i);
    });
  });

  describe("limite anonyme", () => {
    it("le 101e appel reçoit 429 avec délai, sans lien d'abonnement, et le premier refus est mesuré une fois", async () => {
      const app = createApp();
      const call = () => post(app, "/mcp/jsonrpc", { jsonrpc: "2.0", id: 1, method: "ping" });
      for (let i = 0; i < 100; i++) expect((await call()).status).toBe(200);
      const refused = await call();
      expect(refused.status).toBe(429);
      const retry = Number(refused.headers.get("retry-after"));
      expect(retry).toBeGreaterThan(0);
      expect(retry).toBeLessThanOrEqual(3600);
      const body = await refused.json();
      expect(body).toMatchObject({ error: "rate_limit_exceeded", limit: 100, window: "hour" });
      expect(body.upgrade_url).toBeUndefined();
      expect(body.error_description).toContain("No paid API plan is open");
      expect((await call()).status).toBe(429);
      await flush();
      const rows = events("mcp_rate_limited");
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(429);
      expect(JSON.parse(rows[0].meta_json)).toEqual({ mcp: true, tier: "anonymous" });
    });

    it("sur Railway, la clé est l'adresse du proxy : un X-Forwarded-For forgé ne donne pas de nouveau quota", async () => {
      vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environnement-fictif");
      const app = createApp();
      const call = (headers: Record<string, string>) => post(app, "/mcp/jsonrpc", { jsonrpc: "2.0", id: 1, method: "ping" }, headers);
      const first = await call({ "x-real-ip": "198.51.100.7" });
      expect(first.headers.get("x-ratelimit-remaining")).toBe("99");
      const forged = await call({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.99" });
      expect(forged.headers.get("x-ratelimit-remaining")).toBe("98");
      const other = await call({ "x-real-ip": "198.51.100.8" });
      expect(other.headers.get("x-ratelimit-remaining")).toBe("99");
      // IPv6 : un même /64 partage sa fenêtre.
      await call({ "x-real-ip": "2001:db8:1:2::1" });
      const sameNet = await call({ "x-real-ip": "2001:db8:1:2::ffff" });
      expect(sameNet.headers.get("x-ratelimit-remaining")).toBe("98");
    });

    it("la mémoire du limiteur reste bornée", () => {
      for (let i = 0; i < 50_010; i++) checkRateLimit(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
      expect(_bucketCount()).toBeLessThanOrEqual(50_000);
    });
  });

  describe("taille, lots et appelants authentifiés", () => {
    it("un corps trop grand est refusé en 413 avant tout quota", async () => {
      const app = createApp();
      const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "kyc_check", arguments: { name: "x".repeat(MCP_BODY_BYTES) } } });
      const refused = await post(app, "/mcp/jsonrpc", big);
      expect(refused.status).toBe(413);
      expect((await refused.json()).error.code).toBe(-32600);
      const next = await post(app, "/mcp/jsonrpc", { jsonrpc: "2.0", id: 2, method: "ping" });
      expect(next.headers.get("x-ratelimit-remaining")).toBe("99");
    });

    it("un nom FINMA trop long est refusé, un nom répétitif reste rapide", async () => {
      expect(kycCheckTool.handler({ name: "a".repeat(201) }).isError).toBe(true);
      const started = performance.now();
      const out = kycCheckTool.handler({ name: "ag ".repeat(66).trim() });
      expect(out.isError).not.toBe(true);
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it("chaque message d'un lot anonyme coûte un appel, et un lot trop coûteux n'est pas exécuté", async () => {
      const app = createApp();
      const batch = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ jsonrpc: "2.0", id: from + i, method: "ping" }));
      const first = await post(app, "/mcp/jsonrpc", batch(50));
      expect(first.status).toBe(200);
      expect(first.headers.get("x-ratelimit-remaining")).toBe("50");
      for (let i = 0; i < 10; i++) await post(app, "/mcp/jsonrpc", { jsonrpc: "2.0", id: 100 + i, method: "ping" });
      // 60 unités consommées : le contrôle d'entrée accepte le lot suivant (61), sa facturation le refuse (110).
      const handler = vi.spyOn(kycCheckTool, "handler");
      const tooMany = await post(app, "/mcp/jsonrpc", Array.from({ length: 50 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "kyc_check", arguments: { name: "Institution fictive" } } })));
      expect(tooMany.status).toBe(429);
      expect(tooMany.headers.get("retry-after")).not.toBeNull();
      expect(handler).not.toHaveBeenCalled();
      handler.mockRestore();
      await flush();
      expect(events("mcp_rate_limited")).toHaveLength(1);
      expect(events("mcp_tool_call")).toHaveLength(0);
    });

    it("sur Railway, les chemins réécrits partagent la même fenêtre", async () => {
      vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environnement-fictif");
      const app = createApp();
      const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
      const ip = { "x-real-ip": "198.51.100.20" };
      const a = await post(app, "http://www.openswissdata.com/mcp/jsonrpc", ping, { ...ip, host: "www.openswissdata.com" });
      const b = await post(app, "http://www.openswissdata.com/mcp/", ping, { ...ip, host: "www.openswissdata.com" });
      const d = await post(app, "http://mcp.openswissdata.com/", ping, { ...ip, host: "mcp.openswissdata.com" });
      expect([a, b, d].map((r) => r.headers.get("x-ratelimit-remaining"))).toEqual(["99", "98", "97"]);
    });

    it("un jeton authentifié voit les outils de sa portée, pas davantage", async () => {
      const clientId = generateClientId();
      insertClient({ client_id: clientId, client_secret_hash: hashToken(generateClientSecret()), name: "fictif", email: "fictif@example.test", tier: "free", scopes: TIER_DEFAULT_SCOPES.free });
      const token = randomBytes(32).toString("base64url");
      insertToken({ client_id: clientId, access_token_plain: token, refresh_token_plain: null, scope: serializeScopes(TIER_DEFAULT_SCOPES.free) });
      const res = await post(createApp(), "/mcp/jsonrpc", { jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${token}` });
      const names = ((await res.json()).result.tools as { name: string }[]).map((t) => t.name).sort();
      // company_check partage la portée finma:read de kyc_check (go fiche, 06.10.2026).
      expect(names).toEqual(["company_check", "cross_walk", "finma_search", "kyc_check", "tariff_lookup"]);
    });
  });

  describe("appels depuis un navigateur (CORS)", () => {
    it("la requête préalable est acceptée sur toutes les adresses d'entrée, sans cookies", async () => {
      const app = createApp();
      const preflight = { origin: "https://client-web.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type, mcp-protocol-version" };
      for (const [url, host] of [["http://www.openswissdata.com/mcp/jsonrpc", "www.openswissdata.com"], ["http://www.openswissdata.com/mcp", "www.openswissdata.com"], ["http://www.openswissdata.com/mcp/", "www.openswissdata.com"], ["http://mcp.openswissdata.com/", "mcp.openswissdata.com"], ["http://mcp.openswissdata.com/jsonrpc", "mcp.openswissdata.com"]]) {
        const res = await app.request(url, { method: "OPTIONS", headers: { ...preflight, host } });
        expect(res.status, url).toBe(204);
        expect(res.headers.get("access-control-allow-origin"), url).toBe("*");
        expect(res.headers.get("access-control-allow-headers") ?? "", url).toContain("mcp-protocol-version");
        expect(res.headers.get("access-control-allow-credentials"), url).toBeNull();
      }
    });

    it("les réponses exposent l'origine libre et les compteurs, les routes OAuth restent fermées", async () => {
      const app = createApp();
      const res = await post(app, "/mcp/jsonrpc", { jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://client-web.example" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-expose-headers") ?? "").toContain("x-ratelimit-remaining");
      const oauth = await app.request("/mcp/oauth/token", { method: "OPTIONS", headers: { origin: "https://client-web.example", "access-control-request-method": "POST" } });
      expect(oauth.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  describe("mesure des connexions", () => {
    it("enregistre le nom déclaré du client et les versions", async () => {
      await post(createApp(), "/mcp/jsonrpc", {
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.283" } },
      }, { "user-agent": "claude-code/2.1.283" });
      await flush();
      const rows = events("mcp_initialize");
      expect(rows).toHaveLength(1);
      const meta = JSON.parse(rows[0].meta_json);
      expect(meta).toMatchObject({ client_name: "claude-code", client_version: "2.1.283", requested_version: "2025-03-26", negotiated_version: "2025-03-26", authenticated: false, tier: "anonymous" });
      expect(rows[0].ua_class).toBe("mcp_client");
    });

    it("n'enregistre ni adresse ni numéro déguisés en nom de client", async () => {
      const app = createApp();
      for (const name of ["claude-code <moi@exemple.test>", "Jean Dupont +41 79 123 45 67 0791234567"]) {
        await post(app, "/mcp/jsonrpc", {
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "1.0" } },
        });
      }
      await flush();
      const names = events("mcp_initialize").map((r) => JSON.parse(r.meta_json).client_name);
      expect(names).toEqual([null, null]);
      expect(JSON.stringify(events("mcp_initialize"))).not.toMatch(/exemple|0791234567|Dupont/);
    });
  });
});

describe("tariff_lookup pour les agents", () => {
  it("accepte un numéro avec points et espaces", () => {
    _resetDataLoaderCache();
    const sample = getTares().rows[0];
    const dotted = `${sample.hs8.slice(0, 4)}.${sample.hs8.slice(4)}`;
    expect(tariffLookupHandler({ hs8: dotted }).isError).not.toBe(true);
    expect(tariffLookupHandler({ hs8: `${sample.hs8.slice(0, 4)} ${sample.hs8.slice(4, 6)} ${sample.hs8.slice(6)}` }).isError).not.toBe(true);
  });

  it("un préfixe à 6 chiffres liste les lignes suisses qui le prolongent", () => {
    const { rows } = getTares();
    const hs6 = rows[0].hs8.slice(0, 6);
    const expected = rows.filter((r) => r.hs8.startsWith(hs6)).length;
    const out = tariffLookupHandler({ hs8: hs6, lang: "en" });
    expect(out.isError).not.toBe(true);
    const structured = out.structured as { prefix: string; total: number; lines: { hs8: string }[] };
    expect(structured.prefix).toBe(hs6);
    expect(structured.total).toBe(expected);
    expect(structured.lines.every((l) => l.hs8.startsWith(hs6))).toBe(true);
    expect(out.content[0].text).toContain("UNOFFICIAL NOTICE");
    expect(out.content[0].text).toContain("missing values do not mean duty-free");
  });

  it("un préfixe trop large est tronqué à 40 lignes et le dit", () => {
    const { rows } = getTares();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.hs8.slice(0, 2), (counts.get(r.hs8.slice(0, 2)) ?? 0) + 1);
    const big = [...counts.entries()].find(([, n]) => n > 40);
    if (!big) return;
    const out = tariffLookupHandler({ hs8: big[0] });
    expect((out.structured as { lines: unknown[] }).lines).toHaveLength(40);
    expect(out.content[0].text).toContain("first 40 shown");
  });

  it("un numéro inconnu propose les lignes voisines", () => {
    const { rows, byHs8 } = getTares();
    const hs6 = rows[0].hs8.slice(0, 6);
    let unknown = `${hs6}99`;
    for (let n = 99; byHs8.has(unknown) && n > 0; n--) unknown = `${hs6}${String(n).padStart(2, "0")}`;
    if (byHs8.has(unknown)) return;
    const out = tariffLookupHandler({ hs8: unknown, lang: "en" });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("No TARES row");
    expect(out.content[0].text).toContain(rows[0].hs8);
    expect(out.content[0].text).toContain("UNOFFICIAL NOTICE");
    expect(out.content[0].text).toContain("missing values do not mean duty-free");
  });

  it("refuse toujours une entrée qui n'est pas un numéro", () => {
    expect(tariffLookupHandler({ hs8: "abc" }).isError).toBe(true);
    expect(tariffLookupHandler({ hs8: "1" }).isError).toBe(true);
    expect(tariffLookupHandler({ hs8: "123456789" }).isError).toBe(true);
  });
});

describe("kyc_check classe du plus proche au plus lointain", () => {
  it("un nom entier passe avant une simple sous-chaîne (UBS avant « Clos du Doubs »)", async () => {
    const { kycCheckHandler } = await import("../../src/mcp/tools/kyc-check.js");
    const out = kycCheckHandler({ name: "UBS" });
    const names = (out.structured as { registry_matches: { name: string }[] }).registry_matches.map((m) => m.name);
    const doubs = names.findIndex((n) => /doubs/i.test(n));
    const ubsWord = names.findIndex((n) => /(^|\W)UBS(\W|$)/.test(n));
    expect(ubsWord).toBeGreaterThanOrEqual(0);
    if (doubs >= 0) expect(ubsWord).toBeLessThan(doubs);
    expect(names[0]).toMatch(/^UBS\b/);
  });

  it("annonce le vrai total et précise quand la liste est tronquée", async () => {
    const { kycCheckHandler } = await import("../../src/mcp/tools/kyc-check.js");
    const out = kycCheckHandler({ name: "Raiffeisen", top_k: 3 });
    const s = out.structured as { match_count: number; match_total: number };
    expect(s.match_count).toBe(3);
    expect(s.match_total).toBeGreaterThan(3);
    expect(out.content[0].text).toContain(`${s.match_total} authorised entity/entities`);
    expect(out.content[0].text).toContain("closest 3 shown");
  });

  it("trouve les mots dans un autre ordre en dernier recours", async () => {
    const { kycCheckHandler } = await import("../../src/mcp/tools/kyc-check.js");
    const direct = kycCheckHandler({ name: "Raiffeisen Morges" }).structured as { match_total: number };
    const reversed = kycCheckHandler({ name: "Morges Raiffeisen" }).structured as { match_total: number; registry_matches: { name: string }[] };
    if (direct.match_total === 0) return;
    expect(reversed.match_total).toBeGreaterThan(0);
    expect(reversed.registry_matches[0].name).toMatch(/Raiffeisen/i);
  });

  it("ne confond pas un caractère spécial de la requête avec une expression", async () => {
    const { kycCheckHandler } = await import("../../src/mcp/tools/kyc-check.js");
    expect(kycCheckHandler({ name: "(.*)" }).isError).not.toBe(true);
    expect(kycCheckHandler({ name: "a+b[" }).isError).not.toBe(true);
  });
});
