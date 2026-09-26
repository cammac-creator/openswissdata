import { Hono } from "hono";
import { createRequire } from "node:module";
import { getDb } from "../lib/db.js";
import { requireAdmin } from "../lib/admin-middleware.js";
import { diagnoseDependencies } from "../lib/deep-health.js";
import { checkReadiness } from "../lib/readiness.js";
import { finmaFreshness } from "../lib/dataset-freshness.js";

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require("../../package.json") as { version: string };

export const healthRoute = new Hono();

/**
 * Présence du processus uniquement. Le contrôle Railway utilise /ready.
 */
healthRoute.get("/", (c) => {
  return c.json({ status: "ok", version: APP_VERSION, revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? null });
});

healthRoute.get("/ready", (c) => {
  const state = checkReadiness();
  c.header("Cache-Control", "no-store");
  return c.json({ status: state.ready ? "ready" : "not_ready", version: APP_VERSION,
    revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? null, checks: state.checks }, state.ready ? 200 : 503);
});

// Une application disponible peut distribuer des données anciennes : signal distinct.
healthRoute.get("/freshness", (c) => {
  c.header('Cache-Control', 'no-store');
  const row = getDb().prepare("SELECT current_version FROM datasets WHERE id='finma'").get() as { current_version: string | null } | undefined;
  const state = finmaFreshness(row?.current_version);
  return c.json(state, state.status === 'ok' ? 200 : 503);
});


/** Diagnostic privé, à la demande ; les moniteurs publics utilisent /ready et /freshness. */
healthRoute.use('/deep', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});
healthRoute.get('/deep', requireAdmin, async c => {
  const result = await diagnoseDependencies();
  return c.json({ ...result, version: APP_VERSION }, result.status === 'ok' ? 200 : 503);
});
