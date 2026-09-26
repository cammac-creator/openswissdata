// Sentry MUST be initialized before any other import that could throw,
// so the SDK can hook into the global handlers. The init is no-op if
// SENTRY_DSN is not set (dev, test, first deploy).
import { initSentry, captureException, flushSentry } from "./lib/sentry.js";
initSentry();

import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { compress } from "hono/compress";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { healthRoute } from "./routes/health.js";
import { catalogRoute } from "./routes/catalog.js";
import { adminRoute } from "./routes/admin.js";
import { adminStatsRoute } from "./routes/admin-stats.js";
import { crmRoute } from "./routes/crm.js";
import { checkoutRoute } from "./routes/checkout.js";
import { stripeWebhookRoute } from "./routes/stripe-webhook.js";
import { authRoute } from "./routes/auth.js";
import { accountRoute } from "./routes/account.js";
import { downloadRoute, publicDownload } from "./routes/download.js";
import { eventsRoute } from "./routes/events.js";
import { mcpRoute } from "./routes/mcp/index.js";
import { trackApiRequest, trackPageView } from "./lib/track.js";
import { startMcpDataRefresh } from "./mcp/r2-refresh.js";
import { loadEnv } from "./env.js";
import { startOrderDeliveryWorker } from "./lib/order-delivery.js";
import { startFinancialWorker } from "./lib/stripe-financial.js";

export function createApp() {
  const app = new Hono();

  // Ces en-têtes s'appliquent après les réglages généraux, y compris aux redirections.
  app.use("*", async (c, next) => {
    await next();
    if (/^\/api\/(delivery|download)\//.test(c.req.path)) c.header("Referrer-Policy", "no-referrer");
    if (c.req.path.startsWith("/api/delivery/")) {
      c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'none'");
    }
  });

  // --- Error handler — capture in Sentry, return 500 to client ---
  // Hooks before everything so even errors in the routing layer are caught.
  app.onError((err, c) => {
    captureException(err, {
      path: c.req.routePath,
      method: c.req.method,
    });
    console.error("[unhandled]", err);
    return c.json({ error: "internal_server_error" }, 500);
  });

  // --- Security headers (HSTS, CSP, frame-ancestors, referrer-policy) ---
  // Applied globally before any route. Astro inline styles need 'unsafe-inline'
  // for now; tighten to nonce/hash if/when we audit individual pages.
  app.use(
    "*",
    secureHeaders({
      strictTransportSecurity: "max-age=15552000; includeSubDomains",
      xFrameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
      xContentTypeOptions: "nosniff",
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://plausible.io"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: [
          "'self'",
          "https://plausible.io",
          "https://api.stripe.com",
          "https://*.r2.cloudflarestorage.com",
        ],
        frameAncestors: ["'none'"],
        formAction: ["'self'", "https://checkout.stripe.com"],
        baseUri: ["'self'"],
      },
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: ["self", "https://checkout.stripe.com"],
      },
    }),
  );

  // --- Gzip/deflate compression (post-secureHeaders, pre-routes) ---
  // Compresses HTML, CSS, JS, JSON, SVG, etc. above 1 KB. Static binary
  // assets (PNG, fonts) are skipped automatically based on Content-Type.
  // Uses native CompressionStream — works on Node ≥18.
  app.use("*", compress());

  // --- Cache-Control headers ---
  // Sets sensible cache policies depending on path:
  //   - /_astro/* (hashed assets): 1 year, immutable (Astro fingerprints filenames)
  //   - /favicon.* /og-default.png /samples/*: 1 year (rarely change)
  //   - /api/*, explicit MCP API endpoints: no-store (auth-bearing or dynamic)
  //   - Pages HTML : revalidation navigateur, 5 minutes au CDN, sans ancienne version de secours
  // Only set if the route handler did not set its own Cache-Control.
  // Note: `/mcp` and `/mcp/` are the Astro public docs page — only explicit
  // MCP API paths below get no-store.
  app.use("*", async (c, next) => {
    await next();
    if (c.res.headers.has("Cache-Control")) return;
    const path = new URL(c.req.url).pathname;
    const isMcpApi =
      path === "/mcp/jsonrpc" ||
      path === "/mcp/discovery" ||
      path === "/mcp/health" ||
      path.startsWith("/mcp/oauth/");
    if (path.startsWith("/api/") || path === "/admin" || path.startsWith("/admin/") || isMcpApi) {
      c.res.headers.set("Cache-Control", "no-store");
      return;
    }
    if (
      path.startsWith("/_astro/") ||
      (path.startsWith("/samples/") && path !== "/samples/finma-sample.csv") ||
      path === "/favicon.svg" ||
      path === "/favicon.ico" ||
      path === "/og-default.png" ||
      path === "/og-image.png"
    ) {
      c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }
    // Static JSON data shipped by Astro pre-render (codes/search-index.json,
    // .well-known assets) — long cache because they only change on rebuild.
    if (
      path === "/codes/search-index.json" ||
      path.startsWith("/.well-known/")
    ) {
      c.res.headers.set(
        "Cache-Control",
        "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=31536000",
      );
      return;
    }
    // Revalider la page pour éviter de montrer les anciennes promesses commerciales.
    c.res.headers.set(
      "Cache-Control",
      "public, max-age=0, s-maxage=300, must-revalidate",
    );
  });

  // --- Host-based routing for the dedicated MCP sub-domain ---
  //
  // When the request hits `mcp.openswissdata.com` we want the Hono router for
  // MCP to handle the URL at the root (so `/jsonrpc` not `/mcp/jsonrpc`).
  // Implemented by rewriting the request URL to prepend `/mcp` and letting
  // the `app.route("/mcp", mcpRoute)` mount handle the dispatch — keeping a
  // single mount point.
  app.use("*", async (c, next) => {
    const host = (c.req.header("host") ?? "").split(":")[0].toLowerCase();
    const isMcpHost = host === "mcp.openswissdata.com" || host === "mcp.localhost";
    if (!isMcpHost) return next();

    const url = new URL(c.req.url);
    // API/protocol paths stay on the sub-domain (mapped to /mcp/* below):
    // JSON-RPC, discovery, health, the OAuth flow, and OAuth metadata.
    const isMcpApi =
      url.pathname === "/jsonrpc" ||
      url.pathname === "/discovery" ||
      url.pathname === "/health" ||
      url.pathname.startsWith("/oauth/") ||
      url.pathname.startsWith("/.well-known/") ||
      url.pathname.startsWith("/mcp");
    // A human opening the bare sub-domain in a browser would otherwise receive
    // the /mcp HTML while its assets 404 (every path gets "/mcp" prepended, so
    // /_astro/*.css breaks → unstyled page). Send browser GETs to the properly
    // styled docs page on the main host instead. (POST /jsonrpc etc. are API.)
    if (!isMcpApi && (c.req.method === "GET" || c.req.method === "HEAD")) {
      const dest = "https://www.openswissdata.com" + (url.pathname === "/" ? "/mcp" : url.pathname);
      return c.redirect(dest, 302);
    }
    if (url.pathname.startsWith("/mcp")) return next();
    url.pathname = "/mcp" + url.pathname;
    const rewritten = new Request(url, c.req.raw);
    return app.fetch(rewritten);
  });

  // --- Event tracking middleware ---
  // Logs every /api/* request (except health/admin/webhook) into the events
  // table for the /admin dashboard. Best-effort, non-blocking.
  app.use("/api/*", trackApiRequest);
  app.use("*", trackPageView);

  // --- API routes ---
  app.route("/api/health", healthRoute);
  app.route("/api/catalog", catalogRoute);
  app.route("/api/admin", adminRoute);
  app.route("/api/admin/stats", adminStatsRoute);
  app.route("/api/admin/crm", crmRoute);
  app.route("/api/checkout", checkoutRoute);
  app.route("/api/webhook/stripe", stripeWebhookRoute);
  app.route("/api/auth", authRoute);
  app.route("/api/account", accountRoute);
  app.route("/api/events", eventsRoute);
  app.route("/api", downloadRoute);      // serves /api/account/download-request
  app.route("/api", publicDownload);     // serves /api/download/:token

  // --- MCP server (mcp.openswissdata.com / openswissdata.com/mcp/*) ---
  // MUST be mounted BEFORE the static catch-all below.
  app.route("/mcp", mcpRoute);

  // Les liens historiques pointent désormais vers un échantillon de la version publiée.
  app.get("/samples/finma-sample.csv", (c) => c.redirect("/api/catalog/finma?format=csv", 302));

  // --- Static Astro frontend ---
  // web/dist is relative to repo root (Railway runs node dist/index.js from root)
  const webRoot = "./web/dist";
  if (existsSync(webRoot)) {
    // Serve hashed static assets generated by Astro
    app.use("/_astro/*", serveStatic({ root: webRoot }));
    app.use("/samples/*", serveStatic({ root: webRoot }));
    app.use("/favicon.svg", serveStatic({ root: webRoot, path: "/favicon.svg" }));
    app.use("/favicon.ico", serveStatic({ root: webRoot, path: "/favicon.ico" }));
    app.use("/og-image.png", serveStatic({ root: webRoot, path: "/og-image.png" }));

    // Serve HTML pages — rewrite clean URLs to their index.html file
    app.use(
      "*",
      serveStatic({
        root: webRoot,
        rewriteRequestPath: (path) => {
          if (path === "/") return "/index.html";
          if (path.endsWith("/")) return path + "index.html";
          if (!/\.[a-z0-9]{1,6}$/i.test(path)) return path + "/index.html";
          return path;
        },
      }),
    );

    // 404 fallback — serve the Astro-built /404.html with HTTP 404 status.
    // Without this, Hono returns a default text/plain "404 Not Found" body that
    // bypasses the Astro 404.astro page entirely (bad UX + bad SEO signal).
    // Astro outputs `dist/404.html` (not `dist/404/index.html`) for top-level
    // 404 pages, so we read that exact path.
    app.notFound(async (c) => {
      try {
        const fs = await import("node:fs/promises");
        const html = await fs.readFile(`${webRoot}/404.html`, "utf-8");
        return c.html(html, 404);
      } catch {
        return c.text("404 Not Found", 404);
      }
    });
  } else {
    console.warn(
      "[app] web/dist not found — frontend will not be served. Run 'npm run web:build'.",
    );
  }

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const app = createApp();
  serve({ fetch: app.fetch, port: env.PORT });
  console.log(`Listening on :${env.PORT}`);

  // Pull fresh FINMA slices from R2 into the in-memory MCP caches (boot +
  // 12 h safety timer). Fire-and-forget: the server is already listening and
  // serves the committed seed until the first refresh lands. Never blocks boot.
  startMcpDataRefresh();
  const stopDeliveries = startOrderDeliveryWorker();
  const stopFinancial = startFinancialWorker();

  // Flush Sentry events on graceful shutdown so errors right before
  // SIGTERM aren't lost.
  const shutdown = async (sig: string) => {
    stopDeliveries();
    stopFinancial();
    console.log(`[shutdown] received ${sig}, flushing Sentry…`);
    await flushSentry(2000);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
