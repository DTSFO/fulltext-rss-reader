import type { AppEnv } from "@/lib/config/env";
import { getEnv } from "@/lib/config/env";
import { AppError } from "@/lib/errors/app-error";

type DemoResource = "feeds" | "themes";

function demoEnv(env: AppEnv = getEnv()): AppEnv | null {
  return env.DEMO_MODE ? env : null;
}

export function assertDemoCapacity(
  resource: DemoResource,
  existingCount: number,
  incomingCount = 1,
  env: AppEnv = getEnv(),
): void {
  const demo = demoEnv(env);
  if (!demo) return;
  const limit = resource === "feeds" ? demo.DEMO_MAX_FEEDS : demo.DEMO_MAX_THEMES;
  if (existingCount + incomingCount <= limit) return;

  throw new AppError({
    code: "DEMO_LIMIT_REACHED",
    message: resource === "feeds" ? "演示环境的订阅数量已达上限。" : "演示环境的自定义主题数量已达上限。",
    status: 409,
    details: { resource, limit },
  });
}

export function assertDemoReplacementCount(
  resource: DemoResource,
  replacementCount: number,
  env: AppEnv = getEnv(),
): void {
  assertDemoCapacity(resource, 0, replacementCount, env);
}

export function getDemoArticleRetentionLimit(env: AppEnv = getEnv()): number | null {
  return demoEnv(env)?.DEMO_MAX_ARTICLES_PER_FEED ?? null;
}

export function getDemoFeedCreateCooldownMinutes(env: AppEnv = getEnv()): number | null {
  return demoEnv(env)?.DEMO_FEED_CREATE_COOLDOWN_MINUTES ?? null;
}

export function assertDemoFeedCreateAvailable(
  lastAttemptAt: Date,
  now = new Date(),
  env: AppEnv = getEnv(),
): void {
  const cooldownMinutes = getDemoFeedCreateCooldownMinutes(env);
  if (cooldownMinutes === null) return;
  const reservedUntil = new Date(lastAttemptAt.getTime() + cooldownMinutes * 60_000);
  if (reservedUntil <= now) return;

  throw new AppError({
    code: "RATE_LIMITED",
    message: "演示环境新增订阅仍在冷却中。",
    status: 429,
    details: {
      retryAfterSeconds: Math.max(1, Math.ceil((reservedUntil.getTime() - now.getTime()) / 1_000)),
      cooldownMinutes,
    },
  });
}

export function getDemoRefreshCooldownMinutes(env: AppEnv = getEnv()): number | null {
  return demoEnv(env)?.DEMO_REFRESH_COOLDOWN_MINUTES ?? null;
}

export function assertDemoRefreshAvailable(
  reservedUntil: Date | null,
  now = new Date(),
  env: AppEnv = getEnv(),
): void {
  const cooldownMinutes = getDemoRefreshCooldownMinutes(env);
  if (cooldownMinutes === null || !reservedUntil || reservedUntil <= now) return;

  throw new AppError({
    code: "RATE_LIMITED",
    message: "演示环境的手动刷新仍在冷却中。",
    status: 429,
    details: {
      retryAfterSeconds: Math.max(1, Math.ceil((reservedUntil.getTime() - now.getTime()) / 1_000)),
      cooldownMinutes,
    },
  });
}

export function demoRefreshReservation(now = new Date(), env: AppEnv = getEnv()): Date | null {
  const cooldownMinutes = getDemoRefreshCooldownMinutes(env);
  return cooldownMinutes === null ? null : new Date(now.getTime() + cooldownMinutes * 60_000);
}
