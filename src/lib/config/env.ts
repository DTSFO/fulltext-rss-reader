import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  SINGLE_USER_USERNAME: z.string().min(1).default("demo-user"),
  SINGLE_USER_PASSWORD_HASH: z.string().startsWith("$argon2"),
  SESSION_SECRET: z.string().min(32),
  FEED_REFRESH_MINUTES: z.coerce.number().int().positive().default(30),
  REFRESH_BATCH_SIZE: z.coerce.number().int().min(1).max(20).default(4),
  FULL_TEXT_PREFETCH_COUNT: z.coerce.number().int().min(0).max(20).default(3),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }

  return cachedEnv;
}
