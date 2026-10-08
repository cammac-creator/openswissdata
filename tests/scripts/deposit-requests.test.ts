import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { API_BASE, depositRequests, validateLot } from "../../scripts/deposit-requests.mjs";

// Dépôt des demandes de licence (plan du 08.10.2026) : seule étape qui reçoit le secret
// d'administration. Aucune dépendance, aucun appel réseau réel ici (fetch simulé).

const SECRET = "secret-fictif-0123456789";
const API = "https://www.openswissdata.com";

function letter(org: string, over: Record<string, unknown> = {}) {
  return {
    organisation: org,
    to: `statistik@${org}.ch`,
    subject: `Anfrage für eine offene Lizenz auf opendata.swiss (${org})`,
    body: "Sehr geehrte Damen und Herren\n\nText.",
    purpose: `demande-licence:${org}`,
    dataset_ids: ["11111111-1111-1111-1111-111111111111"],
    lang: "de",
    ...over,
  };
}
const lotOf = (...letters: unknown[]) => ({ generated_on: "2026-10-13", letters });

type Reply = { status: number; body?: unknown };
function server(posts: Reply[], list: Reply = { status: 200, body: { letters: [] } }) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown; redirect?: string }> = [];
  let i = 0;
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null, redirect: init.redirect });
    const reply = (init.method ?? "GET") === "POST" ? posts[i++] : list;
    if (!reply) throw new Error("appel inattendu");
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  });
  return { impl, calls };
}

describe("validateLot : rien n'est posté si le lot est suspect", () => {
  it("refuse un motif qui n'est pas une demande de licence", () => {
    expect(() => validateLot(lotOf(letter("a", { purpose: "autre" })))).toThrow(/motif/);
  });
  it("refuse plus de trois lettres", () => {
    expect(() => validateLot(lotOf(letter("a"), letter("b"), letter("c"), letter("d")))).toThrow(/trois/);
  });
  it("refuse deux lettres pour le même éditeur", () => {
    expect(() => validateLot(lotOf(letter("a"), letter("a")))).toThrow(/double/);
  });
  it("refuse un champ manquant ou un objet avec retour à la ligne", () => {
    expect(() => validateLot(lotOf(letter("a", { to: undefined })))).toThrow();
    expect(() => validateLot(lotOf(letter("a", { subject: "Objet\nInjecté: oui, assez long" })))).toThrow();
  });
  it("accepte un lot vide", () => {
    expect(validateLot(lotOf())).toEqual({ generated_on: "2026-10-13", letters: [] });
  });
});

describe("depositRequests", () => {
  it("poste chaque lettre avec le secret dans l'en-tête, jamais dans l'adresse", async () => {
    const s = server([{ status: 200, body: { id: "L1", scheduled_at: 1 } }]);
    const out = await depositRequests({ lot: lotOf(letter("a")), secret: SECRET, apiBase: API, fetchImpl: s.impl });
    const post = s.calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe(`${API}/api/admin/letters`);
    expect(post.headers["x-admin-secret"]).toBe(SECRET);
    expect(post.body).toEqual({ to: "statistik@a.ch", subject: letter("a").subject, body: letter("a").body, purpose: "demande-licence:a" });
    expect(out.deposits).toEqual([{ organisation: "a", purpose: "demande-licence:a", outcome: "deposee", http_status: 200 }]);
  });

  it("409 → déjà déposée (rejeu sans effet) ; 429 → plafond, et plus aucun dépôt après", async () => {
    const s = server([{ status: 409, body: { error: "duplicate_purpose" } }, { status: 429, body: { error: "weekly_cap_reached" } }]);
    const out = await depositRequests({ lot: lotOf(letter("a"), letter("b"), letter("c")), secret: SECRET, apiBase: API, fetchImpl: s.impl });
    expect(out.deposits.map((d) => d.outcome)).toEqual(["deja_deposee", "plafond", "plafond"]);
    expect(s.calls.filter((c) => c.method === "POST")).toHaveLength(2);
    expect(out.failed).toBe(false);
  });

  it("400 (refus) ou 5xx : noté, le passage échoue pour l'alerte", async () => {
    const s = server([{ status: 400, body: { error: "recipient_domain_not_allowed" } }, { status: 502 }]);
    const out = await depositRequests({ lot: lotOf(letter("a"), letter("b")), secret: SECRET, apiBase: API, fetchImpl: s.impl });
    expect(out.deposits.map((d) => d.outcome)).toEqual(["refusee", "erreur"]);
    expect(out.failed).toBe(true);
  });

  it("relit les statuts des seules demandes de licence, sans adresse ni réponse", async () => {
    const list = { status: 200, body: { letters: [
      { kind: "letter", purpose: "demande-licence:a", status: "sent", created_at: 5, to_address: "statistik@a.ch", reply_from: "a.ch", reply_subject: "AW", reply_kind: "human" },
      { kind: "letter", purpose: "Liste des sanctions SECO", status: "sent", created_at: 3, to_address: "x@seco.admin.ch" },
      { kind: "reminder", purpose: "demande-licence:a", status: "queued", created_at: 9, to_address: "statistik@a.ch" },
    ] } };
    const out = await depositRequests({ lot: lotOf(), secret: SECRET, apiBase: API, fetchImpl: server([], list).impl });
    expect(out.statuses).toEqual([{ purpose: "demande-licence:a", status: "sent", created_at: 5 }]);
    expect(JSON.stringify(out)).not.toContain("@");
    expect(out.failed).toBe(false);
  });

  it("ne repose jamais une demande déjà connue du serveur, même annulée à la main (décision humaine)", async () => {
    const list = { status: 200, body: { letters: [
      { kind: "letter", purpose: "Demande-Licence:A", status: "cancelled", created_at: 5 },
    ] } };
    const s = server([{ status: 200, body: { id: "L2", scheduled_at: 1 } }], list);
    const out = await depositRequests({ lot: lotOf(letter("a"), letter("b")), secret: SECRET, apiBase: API, fetchImpl: s.impl });
    expect(out.deposits.map((d) => [d.organisation, d.outcome])).toEqual([["a", "deja_deposee"], ["b", "deposee"]]);
    const posted = s.calls.filter((c) => c.method === "POST").map((c) => (c.body as { purpose: string }).purpose);
    expect(posted).toEqual(["demande-licence:b"]);
  });

  it("liste du serveur illisible avant le dépôt : rien n'est posté", async () => {
    const s = server([{ status: 200 }], { status: 502 });
    const out = await depositRequests({ lot: lotOf(letter("a")), secret: SECRET, apiBase: API, fetchImpl: s.impl });
    expect(s.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(out.deposits.map((d) => d.outcome)).toEqual(["erreur"]);
    expect(out.failed).toBe(true);
  });

  it("une adresse qui a reçu une demande de licence depuis moins de 30 jours n'en reçoit pas d'autre (pas un échec)", async () => {
    const NOW = Date.UTC(2026, 9, 13, 7, 0);
    const list = { status: 200, body: { letters: [
      { kind: "letter", purpose: "demande-licence:z", status: "sent", created_at: NOW - 10 * 86_400_000, to_address: "Statistik@A.ch" },
      { kind: "letter", purpose: "demande-licence:y", status: "sent", created_at: NOW - 31 * 86_400_000, to_address: "statistik@b.ch" },
      { kind: "letter", purpose: "demande-licence:w", status: "cancelled", created_at: NOW - 86_400_000, to_address: "statistik@c.ch" },
    ] } };
    const s = server([{ status: 200, body: { id: "L1" } }, { status: 200, body: { id: "L2" } }], list);
    const out = await depositRequests({ lot: lotOf(letter("a"), letter("b"), letter("c")), secret: SECRET, apiBase: API, fetchImpl: s.impl, now: () => NOW });
    expect(out.deposits.map((d) => [d.organisation, d.outcome])).toEqual([["a", "destinataire_recent"], ["b", "deposee"], ["c", "deposee"]]);
    expect(out.failed).toBe(false);
    expect(JSON.stringify(out)).not.toContain("@");
  });

  it("deux lettres du même lot vers la même adresse : seule la première part", async () => {
    const s = server([{ status: 200, body: { id: "L1" } }]);
    const out = await depositRequests({ lot: lotOf(letter("a"), letter("b", { to: "statistik@a.ch" })), secret: SECRET, apiBase: API, fetchImpl: s.impl });
    expect(out.deposits.map((d) => d.outcome)).toEqual(["deposee", "destinataire_recent"]);
    expect(s.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("aucun appel ne suit une redirection (le secret ne part jamais ailleurs)", async () => {
    const s = server([{ status: 200, body: { id: "L1" } }]);
    await depositRequests({ lot: lotOf(letter("a")), secret: SECRET, apiBase: API, fetchImpl: s.impl });
    expect(s.calls.length).toBeGreaterThan(0);
    for (const c of s.calls) expect(c.redirect, `${c.method} ${c.url}`).toBe("error");
  });

  it("l'adresse du serveur est figée dans le script : aucune variable d'environnement ne la change", () => {
    expect(API_BASE).toBe("https://www.openswissdata.com");
    const source = readFileSync(new URL("../../scripts/deposit-requests.mjs", import.meta.url), "utf8");
    expect([...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1])).toEqual(["ADMIN_SECRET"]);
  });

  it("le secret n'apparaît jamais dans le résultat ni dans les journaux", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    const spyErr = vi.spyOn(console, "error").mockImplementation((...a) => { logs.push(a.join(" ")); });
    try {
      const out = await depositRequests({ lot: lotOf(letter("a")), secret: SECRET, apiBase: API, fetchImpl: server([{ status: 500 }]).impl });
      expect(JSON.stringify(out)).not.toContain(SECRET);
      expect(logs.join("\n")).not.toContain(SECRET);
      expect(logs.join("\n")).not.toContain("statistik@");
    } finally {
      spy.mockRestore();
      spyErr.mockRestore();
    }
  });

  it("refuse de travailler sans secret", async () => {
    await expect(depositRequests({ lot: lotOf(letter("a")), secret: "", apiBase: API, fetchImpl: server([]).impl })).rejects.toThrow(/ADMIN_SECRET/);
  });
});
