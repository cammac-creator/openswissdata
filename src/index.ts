import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { healthRoute } from "./routes/health.js";
import { adminRoute } from "./routes/admin.js";
import { loadEnv } from "./env.js";

export function createApp() {
  const app = new Hono();
  app.route("/api/health", healthRoute);
  app.route("/api/admin", adminRoute);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const app = createApp();
  serve({ fetch: app.fetch, port: env.PORT });
  console.log(`Listening on :${env.PORT}`);
}
