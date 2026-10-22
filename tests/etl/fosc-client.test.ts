import { describe, expect, it, vi } from "vitest";
import { createPoliteClient, FoscBudgetError, FoscHttpError, rateLimitWait } from "../../etl/fosc/client.js";

const ok = (body = "ok") => new Response(body, { status: 200 });

describe("client poli du portail", () => {
  it("attend en doublant sur 429/503, sans jamais attendre moins que Retry-After", async () => {
    const responses = [
      new Response("", { status: 429, headers: { "retry-after": "45" } }),
      new Response("", { status: 503 }),
      ok("fin"),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const client = createPoliteClient({ fetchImpl, sleepImpl: async (ms) => { sleeps.push(ms); }, delayMs: 500, maxRequests: 10 });
    const body = await client.get("https://www.shab.ch/api/v1/publications", { kind: "liste", accept: "application/json", maxBytes: 1000 });
    expect(body.toString()).toBe("fin");
    // 1er refus : max(30 s, 45 s demandés) ; 2e refus : 60 s ; pause de 500 ms avant chaque nouvel appel.
    expect(sleeps).toEqual([45_000, 500, 60_000, 500]);
    expect(client.stats.rateLimited).toBe(2);
    expect(client.stats.requests).toBe(3);
  });

  it("s'arrête au lieu d'insister si le serveur demande plus de 300 s", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "600" } })) as unknown as typeof fetch;
    const client = createPoliteClient({ fetchImpl, sleepImpl: async () => {}, maxRequests: 10 });
    await expect(client.get("https://www.shab.ch/x", { kind: "liste", accept: "*/*", maxBytes: 10 })).rejects.toBeInstanceOf(FoscBudgetError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(rateLimitWait(1, 600_000)).toBeNull();
    expect(rateLimitWait(3, null)).toBe(120_000);
  });

  it("respecte le plafond de requêtes et l'heure limite", async () => {
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    const client = createPoliteClient({ fetchImpl, sleepImpl: async () => {}, maxRequests: 2 });
    await client.get("https://www.shab.ch/a", { kind: "a", accept: "*/*", maxBytes: 10 });
    await client.get("https://www.shab.ch/b", { kind: "b", accept: "*/*", maxBytes: 10 });
    await expect(client.get("https://www.shab.ch/c", { kind: "c", accept: "*/*", maxBytes: 10 })).rejects.toMatchObject({ reason: "requests" });
    const late = createPoliteClient({ fetchImpl, sleepImpl: async () => {}, maxRequests: 5, nowImpl: () => 2_000, deadlineMs: 1_000 });
    await expect(late.get("https://www.shab.ch/d", { kind: "d", accept: "*/*", maxBytes: 10 })).rejects.toMatchObject({ reason: "time" });
  });

  it("une seule requête à la fois, même si deux appels partent ensemble", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return ok();
    }) as unknown as typeof fetch;
    const client = createPoliteClient({ fetchImpl, sleepImpl: async () => {}, maxRequests: 10 });
    await Promise.all([1, 2, 3].map((i) => client.get(`https://www.shab.ch/${i}`, { kind: "x", accept: "*/*", maxBytes: 10 })));
    expect(maxInFlight).toBe(1);
  });

  it("une erreur ne cite jamais le corps de la réponse", async () => {
    const fetchImpl = vi.fn(async () => new Response("CORPS-SECRET", { status: 500 })) as unknown as typeof fetch;
    const client = createPoliteClient({ fetchImpl, sleepImpl: async () => {}, maxRequests: 10 });
    const err = await client.get("https://www.shab.ch/x", { kind: "détail", accept: "*/*", maxBytes: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(FoscHttpError);
    expect(err.message).not.toContain("CORPS-SECRET");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // une seule nouvelle tentative
  });
});
