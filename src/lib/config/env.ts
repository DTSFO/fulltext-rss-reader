import { z } from "zod";

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

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
  DEMO_MODE: booleanEnv.default(false),
  DEMO_MAX_FEEDS: z.coerce.number().int().min(1).max(100).default(5),
  DEMO_MAX_THEMES: z.coerce.number().int().min(1).max(100).default(3),
  DEMO_MAX_ARTICLES_PER_FEED: z.coerce.number().int().min(1).max(1_000).default(50),
  DEMO_FEED_CREATE_COOLDOWN_MINUTES: z.coerce.number().int().min(1).max(1_440).default(1),
  DEMO_REFRESH_COOLDOWN_MINUTES: z.coerce.number().int().min(1).max(1_440).default(10),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }

  return cachedEnv;
}

export function resetEnvCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Environment cache can only be reset in tests.");
  }
  cachedEnv = undefined;
}
