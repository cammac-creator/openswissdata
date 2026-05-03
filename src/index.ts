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
import { adminRoute } from "./routes/admin.js";
import { checkoutRoute } from "./routes/checkout.js";
import { stripeWebhookRoute } from "./routes/stripe-webhook.js";
import { authRoute } from "./routes/auth.js";
import { accountRoute } from "./routes/account.js";
import { downloadRoute, publicDownload } from "./routes/download.js";
import { mcpRoute } from "./routes/mcp/index.js";
import { loadEnv } from "./env.js";

export function createApp() {
  const app = new Hono();

  // --- Error handler — capture in Sentry, return 500 to client ---
  // Hooks before everything so even errors in the routing layer are caught.
  app.onError((err, c) => {
    captureException(err, {
      url: c.req.url,
      method: c.req.method,
      headers: Object.fromEntries(c.req.raw.headers.entries()),
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
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
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
  //   - HTML pages (incl. `/mcp` public docs): 5 min browser, 10 min CDN, SWR 1 day
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
    if (path.startsWith("/api/") || isMcpApi) {
      c.res.headers.set("Cache-Control", "no-store");
      return;
    }
    if (
      path.startsWith("/_astro/") ||
      path.startsWith("/samples/") ||
      path === "/favicon.svg" ||
      path === "/favicon.ico" ||
      path === "/og-default.png" ||
      path === "/og-image.png"
    ) {
      c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }
    // HTML pages — fresh-ish but cacheable at edge with SWR fallback
    c.res.headers.set(
      "Cache-Control",
      "public, max-age=300, s-maxage=600, stale-while-revalidate=86400",
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
    if (url.pathname.startsWith("/mcp")) return next();
    url.pathname = "/mcp" + url.pathname;
    const rewritten = new Request(url, c.req.raw);
    return app.fetch(rewritten);
  });

  // --- API routes ---
  app.route("/api/health", healthRoute);
  app.route("/api/admin", adminRoute);
  app.route("/api/checkout", checkoutRoute);
  app.route("/api/webhook/stripe", stripeWebhookRoute);
  app.route("/api/auth", authRoute);
  app.route("/api/account", accountRoute);
  app.route("/api", downloadRoute);      // serves /api/account/download-request
  app.route("/api", publicDownload);     // serves /api/download/:token

  // --- MCP server (mcp.openswissdata.com / openswissdata.com/mcp/*) ---
  // MUST be mounted BEFORE the static catch-all below.
  app.route("/mcp", mcpRoute);

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

  // Flush Sentry events on graceful shutdown so errors right before
  // SIGTERM aren't lost.
  const shutdown = async (sig: string) => {
    console.log(`[shutdown] received ${sig}, flushing Sentry…`);
    await flushSentry(2000);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
