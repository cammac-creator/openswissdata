import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.string().default("3000").transform(Number),
  DATABASE_PATH: z.string().default("./data/openswissdata.sqlite"),
  BASE_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_SECRET: z.string().min(16).default("dev-admin-secret-change-me"),
  SESSION_SECRET: z.string().min(16).default("dev-session-secret-change-me"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}
