import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { healthRoute } from "./routes/health.js";
import { adminRoute } from "./routes/admin.js";
import { checkoutRoute } from "./routes/checkout.js";
import { stripeWebhookRoute } from "./routes/stripe-webhook.js";
import { authRoute } from "./routes/auth.js";
import { accountRoute } from "./routes/account.js";
import { downloadRoute, publicDownload } from "./routes/download.js";
import { loadEnv } from "./env.js";

export function createApp() {
  const app = new Hono();
  app.route("/api/health", healthRoute);
  app.route("/api/admin", adminRoute);
  app.route("/api/checkout", checkoutRoute);
  app.route("/api/webhook/stripe", stripeWebhookRoute);
  app.route("/api/auth", authRoute);
  app.route("/api/account", accountRoute);
  app.route("/api", downloadRoute);      // serves /api/account/download-request
  app.route("/api", publicDownload);     // serves /api/download/:token
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const app = createApp();
  serve({ fetch: app.fetch, port: env.PORT });
  console.log(`Listening on :${env.PORT}`);
}
