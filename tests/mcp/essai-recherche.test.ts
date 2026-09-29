/**
 * Essai sans clé des trois outils de recherche (décision de Claude-Alain du 29.09.2026) :
 * 20 appels par 24 heures et par réseau, partagés par tariff_semantic_search, classify_text et
 * finma_search, décomptés à part de la limite horaire, chaque message d'un lot compté.
 * Rappel de vérification officiel et appels restants dans chaque réponse, refus lisible sans lien
 * d'achat, jetons authentifiés non concernés, mémoire bornée, mesure sans argument.
 * Bases fictives uniquement ; les deux outils sémantiques sont simulés (aucun modèle chargé).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { _resetRateLimit, _trialBucketCount, checkTrialLimit, ANONYMOUS_TRIAL_LIMIT } from "../../src/mcp/rate-limit.js";
import { dispatch, listTools, SERVER_INSTRUCTIONS } from "../../src/mcp/server.js";
import { finmaSearchTool } from "../../src/mcp/tools/finma-search.js";
import { tariffSemanticSearchTool } from "../../src/mcp/tools/tariff-semantic-search.js";
import { classifyTextTool } from "../../src/mcp/tools/classify-text.js";
import { generateClientId, generateClientSecret, hashToken } from "../../src/mcp/oauth/crypto.js";
import { insertClient, insertToken } from "../../src/mcp/oauth/store.js";
import { TIER_DEFAULT_SCOPES, serializeScopes } from "../../src/mcp/oauth/scopes.js";

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

type App = ReturnType<typeof createApp>;
const post = (app: App, body: unknown, headers: Record<string, string> = {}, path = "/mcp/jsonrpc") =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });

const call = (name: string, args: Record<string, unknown>, id: number | string = 1) =>
  ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const FINMA = (id: number | string = 1) => call("finma_search", { name: "Banque Fictive Exemple" }, id);

const events = (name: string) =>
  getDb().prepare("SELECT status, ua_class, meta_json FROM events WHERE kind='custom' AND name=? ORDER BY id").all(name) as
    Array<{ status: number; ua_class: string; meta_json: string }>;

type TrialField = { tools: string[]; limit: number; used: number; remaining: number; window_hours: number; resets_at: string; official_check: string; retry_after_seconds?: number };
type CallResult = { content: { type: string; text: string }[]; isError?: boolean; trial?: TrialField };

const FAKE_SEMANTIC = { content: [{ type: "text" as const, text: "Résultat fictif de recherche." }] };

function freeToken(): string {
  const clientId = generateClientId();
  insertClient({ client_id: clientId, client_secret_hash: hashToken(generateClientSecret()), name: "fictif", email: "fictif@example.test", tier: "free", scopes: TIER_DEFAULT_SCOPES.free });
  const token = randomBytes(32).toString("base64url");
  insertToken({ client_id: clientId, access_token_plain: token, refresh_token_plain: null, scope: serializeScopes(TIER_DEFAULT_SCOPES.free) });
  return token;
}

describe("Essai sans clé des outils de recherche", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-essai-recherche-"));
    vi.stubEnv("DATABASE_PATH", join(tmp, "fictive.sqlite"));
    vi.stubEnv("SESSION_SECRET", "secret-session-fictif-essai-recherche");
    vi.stubEnv("OAUTH_SIGNING_SECRET", "secret-oauth-fictif-essai-recherche-32");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MCP_BEARER_TOKEN", "");
    getDb();
    _resetRateLimit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    _resetRateLimit();
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("limite exacte et refus lisible", () => {
    it("20 appels servis, le 21e refusé sans exécution, avec délai et sans lien d'achat", async () => {
      const app = createApp();
      const handler = vi.spyOn(finmaSearchTool, "handler");
      for (let i = 1; i <= 20; i++) {
        const res = await post(app, FINMA(i));
        expect(res.status).toBe(200);
        expect(res.headers.get("x-trial-limit")).toBe("20");
        expect(res.headers.get("x-trial-remaining")).toBe(String(20 - i));
        expect(res.headers.get("retry-after")).toBeNull();
        const result = (await res.json()).result as CallResult;
        expect(result.isError).not.toBe(true);
        expect(result.trial).toMatchObject({ limit: 20, used: i, remaining: 20 - i, window_hours: 24 });
      }
      expect(handler).toHaveBeenCalledTimes(20);

      const refused = await post(app, FINMA(21));
      expect(refused.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(20);
      const retry = Number(refused.headers.get("retry-after"));
      expect(retry).toBeGreaterThan(24 * 3600 - 120);
      expect(retry).toBeLessThanOrEqual(24 * 3600);
      expect(refused.headers.get("x-trial-remaining")).toBe("0");
      expect(Number(refused.headers.get("x-trial-reset"))).toBeGreaterThan(Date.now() / 1000);
      const body = await refused.json();
      expect(body.error).toBeUndefined();
      const result = body.result as CallResult;
      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("free trial is used up");
      expect(text).toContain(`retry after ${result.trial?.retry_after_seconds} seconds`);
      expect(text).toContain("kyc_check");
      expect(text).toContain("closed to new subscribers");
      expect(JSON.stringify(body)).not.toMatch(/openswissdata|localhost|pricing|upgrade|checkout|signed files/i);
      expect(result.trial).toMatchObject({ remaining: 0, used: 20, limit: 20 });
      expect(result.trial?.resets_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

      // Les outils gratuits restent ouverts : l'essai a son propre compteur.
      const free = await post(app, call("kyc_check", { name: "Institution fictive" }, 22));
      expect(free.status).toBe(200);
      expect((await free.json()).result.isError).not.toBe(true);
      expect(free.headers.get("x-ratelimit-remaining")).toBe("78");
      expect(free.headers.get("x-trial-limit")).toBeNull();
    });

    it("mesure chaque appel servi et seulement le premier refus de la fenêtre, sans l'argument", async () => {
      const app = createApp();
      for (let i = 0; i < 23; i++) await post(app, call("finma_search", { name: "Jean Dupont Fictif" }, i), { "user-agent": "claude-code/2.1.283" });
      await flush();
      const rows = events("mcp_trial");
      expect(rows).toHaveLength(21);
      expect(rows.slice(0, 20).map((r) => JSON.parse(r.meta_json))).toEqual(
        Array.from({ length: 20 }, (_, i) => ({ mcp: true, tool: "finma_search", outcome: "call", used: i + 1, limit: 20 })),
      );
      expect(rows.slice(0, 20).every((r) => r.status === 200)).toBe(true);
      expect(rows[20].status).toBe(429);
      expect(JSON.parse(rows[20].meta_json)).toEqual({ mcp: true, tool: "finma_search", outcome: "refused", used: 20, limit: 20 });
      expect(rows[0].ua_class).toBe("mcp_client");
      expect(JSON.stringify(rows)).not.toMatch(/Dupont|Fictif/);
      // Les refus d'essai ne sont pas des refus de la limite horaire.
      expect(events("mcp_rate_limited")).toHaveLength(0);
    });
  });

  it("les trois outils partagent la même limite", async () => {
    const app = createApp();
    vi.spyOn(tariffSemanticSearchTool, "handler").mockResolvedValue(FAKE_SEMANTIC);
    vi.spyOn(classifyTextTool, "handler").mockResolvedValue(FAKE_SEMANTIC);
    let remaining = "";
    for (let i = 0; i < 7; i++) {
      for (const msg of [call("tariff_semantic_search", { query: "montre en or" }, `t${i}`), call("classify_text", { text: "boulangerie artisanale" }, `c${i}`), FINMA(`f${i}`)]) {
        const res = await post(app, msg);
        remaining = res.headers.get("x-trial-remaining") ?? "";
        const result = (await res.json()).result as CallResult;
        if (i * 3 + ["t", "c", "f"].indexOf(String(msg.id)[0]) < 20) expect(result.isError, String(msg.id)).not.toBe(true);
        else expect(result.content[0].text).toContain("free trial is used up");
      }
    }
    expect(remaining).toBe("0");
    const last = (await (await post(app, call("tariff_semantic_search", { query: "montre" }, "fin"))).json()).result as CallResult;
    expect(last.isError).toBe(true);
    expect(last.content[0].text).toContain("tariff_lookup");
  });

  it("chaque réseau a sa fenêtre ; un même /64 IPv6 partage la sienne", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environnement-fictif");
    const app = createApp();
    const from = (ip: string, id = 1) => post(app, FINMA(id), { "x-real-ip": ip });
    for (let i = 0; i < 20; i++) await from("198.51.100.30", i);
    expect(((await (await from("198.51.100.30")).json()).result as CallResult).isError).toBe(true);
    // Un X-Forwarded-For forgé ne rouvre pas l'essai.
    const forged = await post(app, FINMA(), { "x-real-ip": "198.51.100.30", "x-forwarded-for": "203.0.113.50" });
    expect(forged.headers.get("x-trial-remaining")).toBe("0");
    const other = await from("198.51.100.31");
    expect(other.headers.get("x-trial-remaining")).toBe("19");
    await from("2001:db8:5:6::1");
    const sameNet = await from("2001:db8:5:6::abcd");
    expect(sameNet.headers.get("x-trial-remaining")).toBe("18");
    const otherNet = await from("2001:db8:5:7::1");
    expect(otherNet.headers.get("x-trial-remaining")).toBe("19");
  });

  it("chaque message d'un lot compte : 25 demandes, 20 servies dans l'ordre, 5 refusées", async () => {
    const app = createApp();
    const handler = vi.spyOn(finmaSearchTool, "handler");
    const res = await post(app, Array.from({ length: 25 }, (_, i) => FINMA(i)));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-remaining")).toBe("75");
    expect(res.headers.get("x-trial-remaining")).toBe("0");
    expect(res.headers.get("retry-after")).toBeNull();
    const replies = (await res.json()) as Array<{ id: number; result: CallResult }>;
    expect(replies).toHaveLength(25);
    expect(handler).toHaveBeenCalledTimes(20);
    for (const reply of replies) {
      if (reply.id < 20) {
        expect(reply.result.isError, String(reply.id)).not.toBe(true);
        expect(reply.result.trial?.used).toBe(reply.id + 1);
      } else {
        expect(reply.result.content[0].text).toContain("free trial is used up");
      }
    }
    await flush();
    expect(events("mcp_trial")).toHaveLength(21);
    expect(events("mcp_tool_call")).toHaveLength(25);
  });

  it("une notification (sans id) ne consomme pas l'essai", async () => {
    const app = createApp();
    const res = await post(app, { jsonrpc: "2.0", method: "tools/call", params: { name: "finma_search", arguments: { name: "Banque" } } });
    expect(res.status).toBe(202);
    const next = await post(app, FINMA());
    expect(next.headers.get("x-trial-remaining")).toBe("19");
  });

  it("un appel direct du dispatcher sans compteur n'exécute pas l'outil", async () => {
    const handler = vi.spyOn(finmaSearchTool, "handler");
    const reply = await dispatch(FINMA(), null);
    expect(handler).not.toHaveBeenCalled();
    const result = reply?.result as CallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("could not be counted");
  });

  describe("rappel de vérification et compteur dans chaque réponse", () => {
    it.each([
      ["finma_search", { name: "Banque Fictive Exemple" }, "https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/"],
      ["tariff_semantic_search", { query: "montre en or" }, "https://xtares.admin.ch"],
      ["classify_text", { text: "boulangerie artisanale" }, "https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/nomenclatures/noga.html"],
    ])("%s : texte et champ d'essai", async (name, args, url) => {
      if (name !== "finma_search") vi.spyOn(name === "classify_text" ? classifyTextTool : tariffSemanticSearchTool, "handler").mockResolvedValue(FAKE_SEMANTIC);
      const result = (await (await post(createApp(), call(name, args))).json()).result as CallResult;
      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      const text = result.content[0].text;
      expect(text).toContain("FREE TRIAL (no key): 19 of 20 trial calls left");
      expect(text).toContain(url);
      expect(text).toMatch(/^(FINMA register search|Résultat fictif)/);
      expect(result.trial).toMatchObject({ tools: ["tariff_semantic_search", "classify_text", "finma_search"], limit: 20, used: 1, remaining: 19, official_check: url });
    });

    it("une entrée invalide coûte un appel et le dit", async () => {
      const result = (await (await post(createApp(), call("finma_search", { name: "x" }))).json()).result as CallResult;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid input");
      expect(result.content[0].text).toContain("19 of 20 trial calls left");
      expect(result.trial?.remaining).toBe(19);
    });
  });

  describe("appelants authentifiés non concernés", () => {
    it("un jeton gratuit garde finma_search sans essai, et le -32001 pour les outils hors portée", async () => {
      const app = createApp();
      const token = freeToken();
      const auth = { authorization: `Bearer ${token}` };
      for (let i = 0; i < 25; i++) {
        const res = await post(app, FINMA(i), auth);
        expect(res.headers.get("x-trial-limit")).toBeNull();
        const result = (await res.json()).result as CallResult;
        expect(result.isError).not.toBe(true);
        expect(result.trial).toBeUndefined();
        expect(result.content[0].text).not.toContain("FREE TRIAL");
      }
      const scoped = await (await post(app, call("classify_text", { text: "boulangerie artisanale" }), auth)).json();
      expect(scoped.error.code).toBe(-32001);
      const list = await (await post(app, { jsonrpc: "2.0", id: 1, method: "tools/list" }, auth)).json();
      expect(JSON.stringify(list)).not.toMatch(/free trial/i);
      await flush();
      expect(events("mcp_trial")).toHaveLength(0);
      // Le réseau n'a rien consommé de son essai anonyme.
      expect((await post(app, FINMA())).headers.get("x-trial-remaining")).toBe("19");
    });

    it("le chemin administrateur n'est pas décompté", async () => {
      vi.stubEnv("MCP_BEARER_TOKEN", "jeton-admin-fictif-essai");
      const app = createApp();
      for (let i = 0; i < 22; i++) {
        const result = (await (await post(app, FINMA(i), { authorization: "Bearer jeton-admin-fictif-essai" })).json()).result as CallResult;
        expect(result.isError).not.toBe(true);
        expect(result.trial).toBeUndefined();
      }
      expect(_trialBucketCount()).toBe(0);
    });
  });

  describe("présentation aux agents", () => {
    it("tools/list anonyme annonce l'essai dans le titre et la description, jamais « data: »", async () => {
      const text = await (await post(createApp(), { jsonrpc: "2.0", id: 1, method: "tools/list" })).text();
      expect(text).not.toMatch(/data:/i);
      const tools = (JSON.parse(text).result.tools as Array<{ name: string; title: string; description: string; annotations: { title: string } }>);
      for (const name of ["tariff_semantic_search", "classify_text", "finma_search"]) {
        const tool = tools.find((t) => t.name === name)!;
        expect(tool.title).toContain("free trial, 20 calls per day");
        expect(tool.annotations.title).toBe(tool.title);
        expect(tool.description).toMatch(/^FREE TRIAL without a key: 20 calls per day per IP address in total/);
      }
      for (const name of ["tariff_lookup", "kyc_check", "cross_walk"]) expect(tools.find((t) => t.name === name)!.title).not.toContain("trial");
    });

    it("initialize annonce l'essai en une phrase, sans « data: », et garde la fermeture de l'offre Pro", async () => {
      const text = await (await post(createApp(), { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sonde", version: "1" } } })).text();
      expect(text).not.toMatch(/data:/i);
      expect(SERVER_INSTRUCTIONS).toContain("Free trial without a key, limited to 20 calls per day per IP address in total: tariff_semantic_search, classify_text and finma_search");
      expect(SERVER_INSTRUCTIONS).toContain("closed to new subscribers");
      expect(SERVER_INSTRUCTIONS.split("\n").filter((l) => /trial/i.test(l))).toHaveLength(1);
    });

    it("la liste complète d'un jeton reste celle d'origine", () => {
      const plain = listTools(() => true);
      expect(JSON.stringify(plain)).not.toMatch(/free trial/i);
      expect(JSON.stringify(listTools(() => true, { trial: true }))).not.toMatch(/data:/i);
    });

    it("la découverte anonyme décrit l'essai à côté de l'accès gratuit", async () => {
      const body = await (await createApp().request("/mcp/discovery")).json();
      expect(body.anonymous_access.trial).toEqual({ tools: ["tariff_semantic_search", "classify_text", "finma_search"], limit: "20 calls per day per IP address", window_hours: 24 });
    });

    it("les en-têtes d'essai sont lisibles depuis un navigateur", async () => {
      const res = await post(createApp(), FINMA(), { origin: "https://client-web.example" });
      expect(res.headers.get("access-control-expose-headers") ?? "").toContain("x-trial-remaining");
    });
  });

  it("la mémoire de l'essai reste bornée", () => {
    for (let i = 0; i < 50_010; i++) checkTrialLimit(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    expect(_trialBucketCount()).toBeLessThanOrEqual(50_000);
    expect(ANONYMOUS_TRIAL_LIMIT).toMatchObject({ calls: 20, window: "day", windowMs: 86_400_000 });
  });
});
