/**
 * Compte, support et tarifs au style Atlas : prix lus dans offers.ts, offres MCP fermées sans
 * formulaire, textes d’aide fidèles aux CGV sans délai de réponse promis, et appels réseau du
 * compte strictement identiques à ceux de l’ancien script (aucune logique de session changée).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP_TOPICS, JOURNEY, SUPPORT_EMAIL, SUPPORT_MESSAGE, supportMailto } from "../../web/src/lib/customer-care";
import { getHreflangAlternates } from "../../web/src/i18n/utils";
import { contractDocument, CURRENT_TERMS_VERSION } from "../../src/legal/catalog";

const ROOT = join(process.cwd(), "web/src");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const LANGS = ["fr", "de", "en"] as const;
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Tarifs", () => {
  const pricing = read("components/PricingPage.astro");

  it("lit tous les montants des fichiers dans offers.ts", () => {
    expect(pricing).toMatch(/from "\.\.\/lib\/offers"/);
    const source = withoutComments(pricing);
    expect(source).not.toMatch(/\b(299|399|797|997|200)\b/);
    expect(source).not.toMatch(/\b(120|160) ?CHF|CHF ?(120|160)\b/);
  });

  it("existe en français, allemand et anglais, avec des variantes de langue réciproques", () => {
    for (const lang of LANGS) expect(read(`pages/${lang === "fr" ? "" : `${lang}/`}pricing.astro`)).toContain("<PricingPage />");
    expect(getHreflangAlternates("/pricing").map(item => item.url)).toEqual(["/pricing", "/de/pricing", "/en/pricing"]);
  });

  it("garde les offres MCP payantes fermées, sans formulaire, aux prix et quotas inchangés", () => {
    const closed = /MCP_CLOSED = \{ pro: \{ monthly: (\d+), requests: (\d+) \}, business: \{ monthly: (\d+), requests: (\d+) \} \}/.exec(pricing);
    expect(closed?.slice(1).map(Number)).toEqual([49, 5000, 199, 50000]);
    const scopes = readFileSync(join(process.cwd(), "src/mcp/oauth/scopes.ts"), "utf8");
    expect(scopes).toMatch(/standalone: \{ day: -1, month: 5_000 \}/);
    expect(scopes).toMatch(/business: \{ day: -1, month: 50_000 \}/);
    for (const lang of LANGS) {
      const mcp = read(`pages/${lang === "fr" ? "" : `${lang}/`}mcp.astro`);
      expect(mcp, lang).toContain("49 CHF");
      expect(mcp, lang).toContain("199 CHF");
    }
    // Les seuls formulaires d’achat sont ceux des fichiers et du bundle.
    const forms = [...pricing.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)];
    expect(forms).toHaveLength(2);
    for (const [form] of forms) {
      expect(form).toContain('action="/api/checkout/start"');
      expect(form).toContain('name="locale" value={lang}');
      expect(form).toMatch(/name="dataset_ids" value=(\{id\}|"bundle")/);
    }
    expect(pricing).not.toMatch(/name="(plan|tier|mcp)/);
    expect(pricing.match(/<CheckoutNotice \/>/g)).toHaveLength(2);
    expect(pricing).toContain("data-closed-banner");
  });

  it("n’affiche ni balisage ni promesse retirée des fiches", () => {
    expect(pricing).toContain('"@type": "FAQPage"');
    expect(pricing).toMatch(/mainEntity: copy\.faq\.map/);
    expect(pricing).not.toMatch(/mises à jour automatiques|automatische Updates|automatic updates|Toujours à jour|RFC.?3161|7[  ,.']?500|bidirection|Support prioritaire|accès immédiat/i);
    expect(pricing).not.toMatch(/\b(LDA|SAP|ERP)\b/);
  });
});

describe("Support", () => {
  const support = read("components/SupportPage.astro");
  const care = read("lib/customer-care.ts");

  it("existe dans les trois langues et reste relié depuis le compte, les tarifs et les pieds de page", () => {
    for (const lang of LANGS) expect(read(`pages/${lang === "fr" ? "" : `${lang}/`}support.astro`)).toContain("<SupportPage />");
    expect(getHreflangAlternates("/support").map(item => item.lang)).toEqual(["fr", "de", "en"]);
    for (const file of ["components/AccountApp.astro", "components/PricingPage.astro", "components/AtlasFooter.astro", "components/Footer.astro"]) {
      expect(read(file), file).toMatch(/L\(["']\/support["']\)/);
    }
  });

  it("décrit les mêmes situations dans les trois langues, avec des liens vers des articles existants", () => {
    const ids = HELP_TOPICS.fr.map(topic => topic.id);
    expect(ids).toEqual(["email-absent", "lien-expire", "connexion", "fichier", "recu-facture", "remboursement", "mcp"]);
    for (const lang of LANGS) {
      expect(HELP_TOPICS[lang].map(topic => topic.id)).toEqual(ids);
      expect(JOURNEY[lang].steps.map(step => step.id)).toEqual(["paiement", "email", "lien", "archive"]);
      const sections = contractDocument(CURRENT_TERMS_VERSION, lang)!.sections.map(section => section.id);
      for (const topic of HELP_TOPICS[lang]) for (const link of topic.links) {
        if (link.href.startsWith("mailto:")) { expect(link.href.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true); continue; }
        expect(link.href.startsWith("/")).toBe(true);
        const anchor = /^\/legal\/cgv#(.+)$/.exec(link.href)?.[1];
        if (anchor) expect(sections, `${lang} ${anchor}`).toContain(anchor);
      }
    }
  });

  it("ne promet aucun délai de réponse et ne cite que les durées réelles du service", () => {
    const texts = [care, support, read("components/AccountApp.astro"), read("components/PricingPage.astro")].map(withoutComments).join("\n");
    const durations = [...texts.matchAll(/(\d+)(?:[  ]|&nbsp;)?(minutes?|Minuten|heures?|h\b|Std\.|Stunden|hours?|jours?|Tagen|Tage|days?)/gi)].map(m => Number(m[1]));
    for (const value of durations) expect([14, 15, 48, 360], `durée ${value}`).toContain(value);
    expect(texts).not.toMatch(/sous 24|within 24|innert 24|jours ouvr|Werktag|business day|répondons sous|réponse garantie|garantierte Antwort|guaranteed response/i);
    expect(texts).not.toMatch(/sous 5 minutes|within 5 minutes|innerhalb von 5 Minuten|réception immédiate|Sofortiger Erhalt|Instant delivery|Apple Pay|Google Pay/i);
  });

  it("prépare un message modèle sans donnée personnelle", () => {
    for (const lang of LANGS) {
      const href = supportMailto(lang);
      expect(href.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
      expect(decodeURIComponent(href.split("body=")[1])).not.toContain("@");
      expect(SUPPORT_MESSAGE[lang].include).toHaveLength(5);
      expect(SUPPORT_MESSAGE[lang].never).toHaveLength(3);
    }
  });
});

describe("Espace client", () => {
  const script = read("scripts/account.ts");
  const app = read("components/AccountApp.astro");

  it("reprend à l’identique les neuf appels réseau de l’ancien script", () => {
    const calls = [
      /fetch\('\/api\/auth\/magic-link', \{\s*method: 'POST',\s*credentials: 'include',\s*headers: \{ 'content-type': 'application\/json' \},\s*body: JSON\.stringify\(\{ email: email \}\),\s*\}\)/,
      /fetch\('\/api\/account', \{ credentials: 'include' \}\)/,
      /fetch\('\/api\/account\/datasets', \{ credentials: 'include' \}\)/,
      /fetch\('\/api\/account\/orders', \{ credentials: 'include' \}\)/,
      /fetch\('\/api\/account\/orders\/' \+ order\.id \+ '\/receipt', \{ credentials: 'include' \}\)/,
      /fetch\('\/api\/account\/mcp', \{ credentials: 'include' \}\)/,
      /fetch\('\/api\/account\/billing-portal', \{ method: 'POST', credentials: 'include' \}\)/,
      /fetch\('\/api\/account\/download-request', \{\s*method: 'POST',\s*credentials: 'include',\s*headers: \{ 'content-type': 'application\/json' \},\s*body: JSON\.stringify\(\{ dataset_id: d\.id \}\),\s*\}\)/,
      /fetch\('\/api\/auth\/logout', \{ method: 'POST', credentials: 'include' \}\)/,
    ];
    for (const call of calls) expect(script).toMatch(call);
    expect(script.match(/\bfetch\(/g)).toHaveLength(calls.length);
    // Mêmes destinations après succès, mêmes contrôles du lien vers les CGV acceptées.
    expect(script).toContain("window.location.href = body.download_url;");
    expect(script).toContain("window.location.href = data.url;");
    expect(script).toContain("window.location.href = pb.url;");
    expect(script).toContain("window.location.href = copy.accountPath;");
    expect(script).toContain(String.raw`/^\/(?:de\/|en\/)?legal\/versions\/\d{4}-\d{2}-\d{2}\/cgv$/`);
    expect(withoutComments(script)).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write|alert\(/);
  });

  it("est une page privée Atlas, sans prix écrit à la main", () => {
    expect(app).toContain("<AtlasLayout");
    expect(app).toContain("noindex={true}");
    expect(read("layouts/AtlasLayout.astro")).toContain("noindex?: boolean");
    expect(withoutComments(app)).not.toMatch(/\b(299|399|797|997)\b/);
    expect(app).toContain("BUNDLE_OFFER.price");
    for (const id of ["banner", "loading-view", "login-view", "login-form", "login-email", "login-msg", "dashboard-view", "dashboard-email", "logout-btn", "datasets-list", "empty-state", "mcp-section", "mcp-meta", "mcp-portal-btn"]) {
      expect(app, id).toContain(`id="${id}"`);
    }
    expect(app).toContain("<noscript>");
  });
});

describe("Corrections du 29.09", () => {
  it("ne décrit plus des mises à jour automatiques dans la description Organization", () => {
    const base = read("layouts/BaseLayout.astro");
    expect(base).not.toMatch(/mises à jour automatiques|automatische Updates|automatic updates/);
    expect(base).toContain("collectes planifiées et contrôlées");
  });

  it("rend leurs puces aux listes de limites", () => {
    expect(read("styles/atlas.css")).toMatch(/\.atlas-limits \{[^}]*list-style:square outside/);
  });
});
