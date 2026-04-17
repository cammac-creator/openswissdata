import { Hono } from "hono";

export const healthRoute = new Hono();

const APP_VERSION = "0.1.0";

healthRoute.get("/", (c) => {
  return c.json({ status: "ok", version: APP_VERSION });
});
