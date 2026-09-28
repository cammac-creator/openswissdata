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
import { getTares, _resetDataLoaderCache } from "../../src/mcp/data-loader.js";

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
      const res = await post(createApp(), "/mcp/jsonrpc", {
        jsonrpc: "2.0", method: "tools/call", params: { name: "kyc_check", arguments: { name: "Institution fictive" } },
      });
      expect(res.status).toBe(202);
      await flush();
      expect(events("mcp_tool_call")).toHaveLength(0);
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
      for (const [path, host] of [["/", "mcp.openswissdata.com"], ["/mcp", "mcp.openswissdata.com"], ["/jsonrpc", "mcp.openswissdata.com"], ["/mcp", "www.openswissdata.com"], ["/mcp/jsonrpc", "www.openswissdata.com"]]) {
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
    it("un appelant anonyme ne voit que les trois outils gratuits, annotés en lecture seule", async () => {
      const res = await post(createApp(), "/mcp/jsonrpc", { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const tools = (await res.json()).result.tools as Array<{ name: string; title: string; annotations: Record<string, unknown> }>;
      expect(tools.map((t) => t.name)).toEqual(["tariff_lookup", "kyc_check", "cross_walk"]);
      for (const t of tools) {
        expect(t.title.length).toBeGreaterThan(5);
        expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      }
    });

    it("la découverte anonyme annonce l'accès gratuit et la documentation", async () => {
      const body = await (await createApp().request("/mcp/discovery")).json();
      expect(body.tools).toEqual(["tariff_lookup", "kyc_check", "cross_walk"]);
      expect(body.anonymous_access.limit).toBe("100 calls per hour per IP address");
      expect(body.supported_protocol_versions).toContain("2025-06-18");
      expect(body.documentation).toMatch(/\/llms\.txt$/);
    });

    it("un outil Pro appelé sans jeton donne un résultat lisible, pas une erreur de protocole", async () => {
      const res = await post(createApp(), "/mcp/jsonrpc", {
        jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "classify_text", arguments: { text: "fabrication de chocolat" } },
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

  describe("mesure des connexions", () => {
    it("enregistre le nom déclaré du client et les versions, sans arobase", async () => {
      await post(createApp(), "/mcp/jsonrpc", {
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "claude-code <moi@exemple.test>", version: "2.1.283" } },
      }, { "user-agent": "claude-code/2.1.283" });
      await flush();
      const rows = events("mcp_initialize");
      expect(rows).toHaveLength(1);
      const meta = JSON.parse(rows[0].meta_json);
      expect(meta).toMatchObject({ client_version: "2.1.283", requested_version: "2025-03-26", negotiated_version: "2025-03-26", authenticated: false, tier: "anonymous" });
      expect(meta.client_name).not.toContain("@");
      expect(meta.client_name.startsWith("claude-code")).toBe(true);
      expect(rows[0].ua_class).toBe("mcp_client");
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
    const out = tariffLookupHandler({ hs8: unknown });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("No TARES row");
    expect(out.content[0].text).toContain(rows[0].hs8);
  });

  it("refuse toujours une entrée qui n'est pas un numéro", () => {
    expect(tariffLookupHandler({ hs8: "abc" }).isError).toBe(true);
    expect(tariffLookupHandler({ hs8: "1" }).isError).toBe(true);
    expect(tariffLookupHandler({ hs8: "123456789" }).isError).toBe(true);
  });
});
