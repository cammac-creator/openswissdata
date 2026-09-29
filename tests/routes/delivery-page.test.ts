import '../helpers/session-origin.js';
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Présentation Atlas de /api/delivery/:token : chaque état est expliqué, dans la langue du lecteur,
// sans jeton hors du formulaire de confirmation ni ressource chargée. Le contrat HTTP est
// verrouillé à part (delivery-contract.test.ts).

const { signedUrlMock } = vi.hoisted(() => ({ signedUrlMock: vi.fn() }));
vi.mock("../../src/lib/r2.js", () => ({ signedDownloadUrl: signedUrlMock, uploadZip: vi.fn() }));

import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import {
  DELIVERY_DOUBLE_CLICK_SECONDS, DELIVERY_LINK_HOURS, DELIVERY_RESPONSE_TEXTS,
  deliveryConfirmationPage, deliveryLocaleFor, deliveryLocaleFromHeader, deliveryNoticePage, deliveryStateFor,
  type DeliveryLocale, type DeliveryState,
} from "../../src/lib/delivery-page.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROUTE_SOURCE = readFileSync(new URL("../../src/routes/download.ts", import.meta.url), "utf8");
const WORKER_SOURCE = readFileSync(new URL("../../src/lib/order-delivery.ts", import.meta.url), "utf8");
const LOCALES: DeliveryLocale[] = ["fr", "de", "en"];
const STATES: DeliveryState[] = ["invalid", "unknown", "expired", "used", "unavailable", "revoked", "outside", "missing", "error"];
const FORBIDDEN = /<script|<link\b|<img\b|<iframe|<object|<embed|\bsrc=|url\(|@import|@font-face|\bon[a-z]+=/i;
const DAY = 86_400_000;

describe("page de livraison Atlas", () => {
  it("chaque refus texte de redeemDownload a un état présenté, et la table ne garde aucun état mort", () => {
    const body = ROUTE_SOURCE.slice(ROUTE_SOURCE.indexOf("async function redeemDownload"), ROUTE_SOURCE.indexOf("publicDownload.get(\"/download/:token\""));
    const responses = [...body.matchAll(/c\.text\("([^"]+)",\s*(\d{3})\)/g)].map(([, text, status]) => `${status} ${text}`);
    expect(responses.length).toBeGreaterThanOrEqual(9);
    expect([...new Set(responses)].sort()).toEqual([...DELIVERY_RESPONSE_TEXTS].sort());
    for (const key of responses) expect(deliveryStateFor(Number(key.slice(0, 3)), key.slice(4))).not.toBe("error");
    expect(deliveryStateFor(418, "inattendu")).toBe("error");
    expect(deliveryStateFor(410, "token already used ")).toBe("error");
  });

  it("les durées affichées sont celles du code : 48 h de validité, 90 s de double clic", () => {
    expect(ROUTE_SOURCE).toMatch(new RegExp(`DOWNLOAD_TOKEN_TTL_MS = ${DELIVERY_LINK_HOURS} \\* 3600 \\* 1000;`));
    expect(WORKER_SOURCE).toMatch(new RegExp(`TOKEN_TTL_MS = ${DELIVERY_LINK_HOURS} \\* 3600_000;`));
    expect(ROUTE_SOURCE).toContain(`const graceMs = c.req.method === "POST" ? ${DELIVERY_DOUBLE_CLICK_SECONDS}_000 : 0;`);
    for (const locale of LOCALES) {
      const html = deliveryConfirmationPage(locale, "a".repeat(43));
      expect(html).toContain(`${DELIVERY_LINK_HOURS} `);
      expect(html).toContain(`${DELIVERY_DOUBLE_CLICK_SECONDS} s`);
    }
  });

  it("langue du POST : Accept-Language pondéré, français par défaut", () => {
    expect(deliveryLocaleFromHeader("de-CH,de;q=0.9,fr;q=0.8")).toBe("de");
    expect(deliveryLocaleFromHeader("en-GB,en;q=0.9")).toBe("en");
    expect(deliveryLocaleFromHeader("it-CH,it;q=0.9,fr;q=0.5,de;q=0.4")).toBe("fr");
    expect(deliveryLocaleFromHeader("de;q=0.3, en;q=0.8")).toBe("en");
    expect(deliveryLocaleFromHeader("fr;q=0, en")).toBe("en");
    expect(deliveryLocaleFromHeader("it, es")).toBe("fr");
    expect(deliveryLocaleFromHeader("*")).toBe("fr");
    expect(deliveryLocaleFromHeader("")).toBe("fr");
    expect(deliveryLocaleFromHeader(undefined)).toBe("fr");
  });

  it("confirmation : un seul formulaire, jeton uniquement dans sa cible, liens localisés, aucune ressource", () => {
    const token = "Tk_-".repeat(10) + "abc";
    for (const locale of LOCALES) {
      const html = deliveryConfirmationPage(locale, token);
      expect(html.startsWith(`<!doctype html><html lang="${locale}">`)).toBe(true);
      expect(html.split(token).length - 1).toBe(1);
      expect(html).toContain(`<form method="post" action="/api/delivery/${token}"><button type="submit">`);
      expect(html.match(/<form\b/g)).toHaveLength(1);
      expect(html).not.toMatch(/<input|<select|<textarea|<button[^>]*\bname=/);
      expect(html).not.toMatch(FORBIDDEN);
      const prefix = locale === "fr" ? "" : `/${locale}`;
      expect(html).toContain(`href="${prefix}/account"`);
      expect(html).toContain(`href="${prefix}/support#lien-expire"`);
      expect(html).toContain('<meta name="referrer" content="no-referrer">');
      expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    }
    expect(deliveryConfirmationPage("de", token)).toContain("Datei herunterladen");
    expect(deliveryConfirmationPage("fr", token)).toContain("Télécharger mon fichier");
    expect(deliveryConfirmationPage("en", token)).toContain("Download my file");
  });

  it("chaque état a sa page dans les trois langues, sans formulaire ni jeton, avec une action utile", () => {
    const seen = new Set<string>();
    for (const locale of LOCALES) for (const state of STATES) {
      const html = deliveryNoticePage(locale, state);
      expect(html.startsWith(`<!doctype html><html lang="${locale}">`)).toBe(true);
      expect(html).not.toMatch(/<form|<input|<button/);
      expect(html).not.toMatch(FORBIDDEN);
      expect(html).not.toMatch(/token|entitlement|internal_server_error/);
      const title = /<h1>([^<]+)<\/h1>/.exec(html)?.[1];
      expect(title, `${locale}/${state}`).toBeTruthy();
      seen.add(`${locale}:${title}`);
      const prefix = locale === "fr" ? "" : `/${locale}`;
      expect(html).toMatch(new RegExp(`href="${prefix}/(account|support)`));
      if (state === "error") expect(html).toContain(`<a class="action" href="?lang=${locale}">`);
      else expect(html).not.toContain('href="?lang=');
    }
    expect(seen.size).toBe(LOCALES.length * STATES.length);
  });

  it("les promesses restent exactes : droit retiré sans affirmer un remboursement, lien non consommé seulement quand c'est vrai", () => {
    expect(deliveryNoticePage("fr", "revoked")).toContain("par exemple après un remboursement complet ou pendant l’examen d’une contestation");
    // Ces trois refus précèdent la consommation dans redeemDownload : le dire est exact.
    for (const state of ["revoked", "outside", "missing"] as const) expect(deliveryNoticePage("fr", state)).toMatch(/lien n’a pas été utilisé/i);
    for (const state of ["used", "unavailable", "expired", "unknown", "error"] as const) expect(deliveryNoticePage("fr", state)).not.toMatch(/lien n’a pas été utilisé/i);
    expect(deliveryNoticePage("fr", "unknown")).toContain(`${DELIVERY_LINK_HOURS} heures, puis il est effacé`);
    expect(deliveryNoticePage("de", "used")).toContain(`vor mehr als ${DELIVERY_DOUBLE_CLICK_SECONDS} Sekunden`);
  });
});

describe("page de livraison servie par la route", () => {
  let tmp: string;
  let customerId: number;
  const now = Date.now();
  const browser = (lang: string) => ({ accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": lang, "content-type": "application/x-www-form-urlencoded", origin: "null" });
  const issue = (token: string, extra: { usedAt?: number; expiresAt?: number } = {}) => {
    getDb().prepare("INSERT INTO download_tokens(token,customer_id,dataset_id,version,expires_at,used_at,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(token, customerId, "tares", "2026.09.28", extra.expiresAt ?? now + 48 * 3600_000, extra.usedAt ?? null, now);
    return token;
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-livraison-page-"));
    process.env.DATABASE_PATH = join(tmp, "fictive.sqlite");
    const db = getDb();
    customerId = Number(db.prepare("INSERT INTO customers(email,created_at) VALUES('acheteur@example.test',?)").run(now).lastInsertRowid);
    db.prepare("INSERT INTO datasets(id,name,slug,price_chf,stripe_price_id,current_version,created_at) VALUES('tares','TARES','tares',29900,'price_fictif','2026.09.28',?)").run(now);
    db.prepare("INSERT INTO versions(dataset_id,version,r2_key,sha256,size_bytes,released_at) VALUES('tares','2026.09.28','fictif/tares.zip',?,1000,?)").run("0".repeat(64), now - DAY);
    const order = db.prepare("INSERT INTO orders(customer_id,stripe_session_id,amount_chf,items_json,status,created_at) VALUES(?,'cs_fictif',29900,'[\"tares\"]','paid',?)").run(customerId, now);
    db.prepare("INSERT INTO entitlements(customer_id,dataset_id,order_id,updates_until,created_at) VALUES(?,'tares',?,?,?)").run(customerId, Number(order.lastInsertRowid), now + 360 * DAY, now);
    signedUrlMock.mockReset();
    signedUrlMock.mockResolvedValue("https://compte-fictif.r2.cloudflarestorage.com/osd/tares.zip?X-Amz-Signature=fictive");
  });
  afterEach(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); delete process.env.DATABASE_PATH; });

  it("le refus d'un POST est une page HTML dans la langue du navigateur, sans le jeton", async () => {
    const token = issue("U".repeat(43), { usedAt: now - 91_000 });
    for (const [lang, expected] of [["de-CH,de;q=0.9", "Dieser Link wurde bereits verwendet"], ["en-US,en;q=0.9", "This link has already been used"], ["it-CH", "Ce lien a déjà servi"]] as const) {
      const res = await createApp().request(`/api/delivery/${token}`, { method: "POST", headers: browser(lang), body: "" });
      expect(res.status).toBe(410);
      expect(res.headers.get("content-type")).toBe("text/html; charset=UTF-8");
      const html = await res.text();
      expect(html).toContain(expected);
      expect(html).not.toContain(token);
    }
  });

  it("stockage indisponible : page d'erreur sans message technique, retour possible à la confirmation", async () => {
    const token = issue("K".repeat(43));
    signedUrlMock.mockRejectedValueOnce(new Error("Stockage fictif indisponible sk_live_fictif"));
    const res = await createApp().request(`/api/delivery/${token}`, { method: "POST", headers: browser("fr-CH,fr;q=0.9"), body: "" });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("text/html; charset=UTF-8");
    const html = await res.text();
    expect(html).toContain("Le téléchargement n’a pas pu démarrer");
    expect(html).toContain('href="?lang=fr"');
    expect(html).not.toMatch(/Stockage fictif|sk_live|KKKK/);
  });

  it("GET : ?lang= du mail prime, sinon la langue du navigateur (lien de partage de l'espace client)", async () => {
    expect(deliveryLocaleFor("de", "en-GB")).toBe("de");
    expect(deliveryLocaleFor("xx", "en-GB,en;q=0.9")).toBe("en");
    expect(deliveryLocaleFor(undefined, "de-CH")).toBe("de");
    expect(deliveryLocaleFor(undefined, undefined)).toBe("fr");
    const token = issue("L".repeat(43));
    const shared = await createApp().request(`/api/delivery/${token}`, { headers: { "accept-language": "de-CH,de;q=0.9" } });
    expect(shared.status).toBe(200);
    expect(await shared.text()).toContain('<html lang="de">');
    const fromMail = await createApp().request(`/api/delivery/${token}?lang=fr`, { headers: { "accept-language": "de-CH,de;q=0.9" } });
    expect(await fromMail.text()).toContain('<html lang="fr">');
    expect(getDb().prepare("SELECT used_at FROM download_tokens WHERE token=?").get(token)).toEqual({ used_at: null });
  });

  it("GET d'un lien coupé : page « lien incomplet » dans la langue demandée", async () => {
    const res = await createApp().request("/api/delivery/lien-coupe?lang=en");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("This link is incomplete");
    const fromBrowser = await createApp().request("/api/delivery/lien-coupe", { headers: { "accept-language": "de-CH" } });
    expect(await fromBrowser.text()).toContain("Dieser Link ist unvollständig");
  });

  it("le lien historique /api/download garde ses réponses texte", async () => {
    const res = await createApp().request(`/api/download/${"Z".repeat(43)}`, { headers: browser("fr") });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
    expect(await res.text()).toBe("token not found");
  });
});
