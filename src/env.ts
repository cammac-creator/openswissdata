import { z } from "zod";

const isProd = process.env.NODE_ENV === "production";

/**
 * In production all Stripe, Resend, and R2 credentials are required — the
 * server must refuse to start rather than serving requests that will 500 at
 * runtime. In dev/test they remain optional so local runs don't need real
 * cloud credentials.
 */
const prodRequired = (s: z.ZodString) =>
  isProd ? s : s.optional();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().default("./data/openswissdata.sqlite"),
  BASE_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_SECRET: isProd
    ? z.string().min(16)
    : z.string().min(16).default("dev-admin-secret-change-me"),
  SESSION_SECRET: isProd
    ? z.string().min(16)
    : z.string().min(16).default("dev-session-secret-change-me"),
  // Stripe — required in production (C1, C2)
  STRIPE_SECRET_KEY: prodRequired(z.string().min(1)),
  STRIPE_WEBHOOK_SECRET: prodRequired(z.string().min(1)),
  STRIPE_PRICE_BUNDLE: prodRequired(z.string().min(1)),
  // Resend — optional (missing key = graceful no-email path, not 500)
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  // R2 — required in production (C1)
  R2_ACCOUNT_ID: prodRequired(z.string().min(1)),
  R2_ACCESS_KEY_ID: prodRequired(z.string().min(1)),
  R2_SECRET_ACCESS_KEY: prodRequired(z.string().min(1)),
  R2_BUCKET: prodRequired(z.string().min(1)),
  R2_PUBLIC_URL: z.string().optional(),
  // MCP server — optional (missing token = auth disabled, suitable for dev)
  MCP_BEARER_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}
