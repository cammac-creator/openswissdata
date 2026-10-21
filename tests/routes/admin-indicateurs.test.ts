import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../../src/index.js";
import { getDb, closeDb } from "../../src/lib/db.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Relevé de chiffres pour la séance hebdomadaire (21.10.2026) : des comptes seulement, sous des clés fixes.
// Jamais une adresse, une empreinte de visiteur, un identifiant de client ni un nom fourni par un appelant.
// Ventes et comptes : même règle que le CRM (comptes internes exclus de trois façons).
const SECRET = "test-secret-1234567890";
const MAINTENANT = Date.now();

function remplir() {
  const db = getDb();
  const client = db.prepare("INSERT INTO customers (email, created_at) VALUES (?, ?)");
  const avant = MAINTENANT - 3_600_000;
  const acheteur = Number(client.run("acheteur-fictif@example.test", avant).lastInsertRowid);
  const admin = Number(client.run("admin-fictif@example.test", avant).lastInsertRowid);
  const interneListe = Number(client.run("interne-liste@example.test", avant).lastInsertRowid);
  const interneFiche = Number(client.run("interne-fiche@example.test", avant).lastInsertRowid);
  db.prepare("INSERT INTO crm_profiles (customer_id, internal, updated_at) VALUES (?, 1, ?)").run(interneFiche, avant);
  const commande = db.prepare(
    "INSERT INTO orders (customer_id, stripe_session_id, amount_chf, items_json, status, refunded_chf, created_at) VALUES (?, ?, ?, '[]', ?, ?, ?)",
  );
  commande.run(acheteur, "cs_live_reel_1", 29_900, "paid", 0, avant);
  commande.run(acheteur, "cs_live_reel_2", 29_900, "paid", 29_900, avant); // remboursée
  commande.run(acheteur, "cs_test_essai", 29_900, "paid", 0, avant); // mode test
  commande.run(admin, "cs_live_admin", 29_900, "paid", 0, avant); // ADMIN_EMAILS
  commande.run(interneListe, "cs_live_interne_liste", 29_900, "paid", 0, avant); // CRM_INTERNAL_EMAILS
  commande.run(interneFiche, "cs_live_interne_fiche", 29_900, "paid", 0, avant); // crm_profiles.internal
  commande.run(acheteur, "cs_live_ancienne", 39_900, "paid", 0, MAINTENANT - 40 * 86_400_000); // hors fenêtre
  const ev = db.prepare(
    "INSERT INTO events (kind, name, status, visitor_hash, ua_class, meta_json, origin, ts) VALUES (?, ?, 200, ?, ?, ?, ?, ?)",
  );
  const t = MAINTENANT - 60_000;
  ev.run("custom", "page_view", "v2:aaaa", "desktop", JSON.stringify({ path: "/finma/mouvements" }), "server", t);
  ev.run("custom", "page_view", "v2:aaaa", "desktop", JSON.stringify({ path: "/finma/autre" }), "server", t);
  ev.run("custom", "page_view", "v2:bbbb", "mobile", JSON.stringify({ path: "/" }), "server", t);
  ev.run("custom", "page_view", "v2:bbbb", "mobile", JSON.stringify({ path: "/Quelqu'un@exemple" }), "server", t); // section illisible
  ev.run("custom", "page_view", "v2:cccc", "bot", JSON.stringify({ path: "/finma/mouvements" }), "server", t); // robot : écarté
  ev.run("custom", "mcp_tool_call", "v2:dddd", "unknown", JSON.stringify({ tool: "entity_history", admin: false }), "server", t);
  ev.run("custom", "mcp_tool_call", "v2:eeee", "unknown", JSON.stringify({ tool: "entity_history", admin: false }), "server", t);
  ev.run("custom", "mcp_tool_call", "v2:ffff", "human_authenticated", JSON.stringify({ tool: "entity_history", admin: true }), "server", t); // admin
  ev.run("custom", "mcp_tool_call", "v2:gggg", "unknown", JSON.stringify({ tool: "quelqu-un@exemple.test", admin: false }), "server", t); // nom libre
  ev.run("custom", "sample_served", "v2:aaaa", "desktop", null, "server", t); // événement du serveur
  ev.run("custom", "nom_libre_choisi_par_un_appelant", "v2:aaaa", "desktop", null, "client", t); // déclaré par un appelant
  ev.run("custom", "sample_served", "v2:hhhh", "desktop", null, "client", t); // nom réservé mais origine client
}

describe("GET /api/admin/indicateurs", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "osd-indicateurs-"));
    process.env.DATABASE_PATH = join(tmp, "t.sqlite");
    process.env.ADMIN_SECRET = SECRET;
    process.env.ADMIN_EMAILS = "admin-fictif@example.test";
    process.env.CRM_INTERNAL_EMAILS = "interne-liste@example.test";
  });

  afterEach(() => {
    closeDb();
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.ADMIN_SECRET;
    delete process.env.ADMIN_EMAILS;
    delete process.env.CRM_INTERNAL_EMAILS;
  });

  it("refuse sans le secret d'administration", async () => {
    const app = createApp();
    expect((await app.request("/api/admin/indicateurs")).status).toBe(401);
    const faux = await app.request("/api/admin/indicateurs", { headers: { "x-admin-secret": "test-secret-123456789X" } });
    expect(faux.status).toBe(401);
  });

  it("rend des comptes justes : ni test, ni remboursement, ni compte interne, ni robot", async () => {
    const app = createApp();
    remplir();
    const res = await app.request("/api/admin/indicateurs?days=7", { headers: { "x-admin-secret": SECRET } });
    expect(res.status).toBe(200);
    const d = await res.json() as Record<string, any>;
    expect(d.fenetre_jours).toBe(7);
    expect(d.ventes.periode).toEqual({ commandes: 2, clients: 1, net_centimes: 29_900 });
    expect(d.ventes.depuis_toujours).toEqual({ commandes: 3, clients: 1, net_centimes: 69_800 });
    expect(d.comptes_crees).toBe(1);
    expect(d.visites.visiteurs_jours_navigateurs).toBe(2);
    expect(d.visites.par_section).toEqual([
      { section: "accueil", visiteurs_jours: 1 },
      { section: "autre", visiteurs_jours: 1 },
      { section: "finma", visiteurs_jours: 1 },
    ]);
    expect(d.mcp.entity_history.appels).toBe(2);
    expect(d.mcp.entity_history.visiteurs_jours).toBe(2);
    expect(d.mcp.autre.appels).toBe(1);
    expect(d.evenements).toEqual([{ nom: "sample_served", nombre: 1, visiteurs_jours: 1 }]);
  });

  it("ne laisse sortir aucune adresse, empreinte, référence de paiement ni nom fourni par un appelant", async () => {
    const app = createApp();
    remplir();
    const texte = await (await app.request("/api/admin/indicateurs", { headers: { "x-admin-secret": SECRET } })).text();
    expect(texte).not.toMatch(/@/);
    expect(texte).not.toMatch(/v2:/);
    expect(texte).not.toMatch(/cs_live|cs_test/);
    expect(texte).not.toContain("mouvements");
    expect(texte).not.toContain("nom_libre");
  });

  it("borne la fenêtre entre 1 et 90 jours", async () => {
    const app = createApp();
    const lire = async (q: string) =>
      (await (await app.request(`/api/admin/indicateurs?days=${q}`, { headers: { "x-admin-secret": SECRET } })).json() as { fenetre_jours: number }).fenetre_jours;
    expect(await lire("0")).toBe(7);
    expect(await lire("500")).toBe(90);
    expect(await lire("abc")).toBe(7);
    expect(await lire("30")).toBe(30);
  });
});
