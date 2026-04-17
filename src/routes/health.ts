import { Hono } from "hono";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require("../../package.json") as { version: string };

export const healthRoute = new Hono();

healthRoute.get("/", (c) => {
  return c.json({ status: "ok", version: APP_VERSION });
});
