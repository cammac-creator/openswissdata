import { z } from "zod";

const isProd = process.env.NODE_ENV === "production";

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
  // Populated in later sprints (Stripe = Sprint 4, Resend = Sprint 4, R2 = Sprint 2)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}
