import { describe, expect, it } from "vitest";

import type { AppEnv } from "@/lib/config/env";

import {
  assertDemoCapacity,
  assertDemoFeedCreateAvailable,
  assertDemoRefreshAvailable,
  assertDemoReplacementCount,
  demoRefreshReservation,
  getDemoArticleRetentionLimit,
} from "./demo-policy";

function testEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: "test",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: "postgres://unused/unused",
    SINGLE_USER_USERNAME: "demo-user",
    SINGLE_USER_PASSWORD_HASH: "$argon2id$test",
    SESSION_SECRET: "test-session-secret-at-least-32-bytes",
    FEED_REFRESH_MINUTES: 30,
    REFRESH_BATCH_SIZE: 4,
    FULL_TEXT_PREFETCH_COUNT: 3,
    DEMO_MODE: true,
    DEMO_MAX_FEEDS: 5,
    DEMO_MAX_THEMES: 3,
    DEMO_MAX_ARTICLES_PER_FEED: 50,
    DEMO_FEED_CREATE_COOLDOWN_MINUTES: 1,
    DEMO_REFRESH_COOLDOWN_MINUTES: 10,
    ...overrides,
  };
}

describe("hosted demo policy", () => {
  it("does not apply limits when demo mode is disabled", () => {
    const env = testEnv({ DEMO_MODE: false });
    expect(() => assertDemoCapacity("feeds", 999, 1, env)).not.toThrow();
    expect(() => assertDemoReplacementCount("themes", 999, env)).not.toThrow();
    expect(getDemoArticleRetentionLimit(env)).toBeNull();
    expect(() => assertDemoFeedCreateAvailable(new Date(), new Date(), env)).not.toThrow();
    expect(demoRefreshReservation(new Date(0), env)).toBeNull();
  });

  it("reports deterministic feed, theme, and replacement quota errors", () => {
    const env = testEnv({ DEMO_MAX_FEEDS: 2, DEMO_MAX_THEMES: 1 });
    expect(() => assertDemoCapacity("feeds", 2, 1, env)).toThrowError(
      expect.objectContaining({ code: "DEMO_LIMIT_REACHED", status: 409, details: { resource: "feeds", limit: 2 } }),
    );
    expect(() => assertDemoCapacity("themes", 1, 1, env)).toThrowError(
      expect.objectContaining({ code: "DEMO_LIMIT_REACHED", details: { resource: "themes", limit: 1 } }),
    );
    expect(() => assertDemoReplacementCount("themes", 2, env)).toThrowError(
      expect.objectContaining({ code: "DEMO_LIMIT_REACHED" }),
    );
  });

  it("returns a retry duration for account-level feed creation cooldowns", () => {
    const env = testEnv({ DEMO_FEED_CREATE_COOLDOWN_MINUTES: 3 });
    const attemptedAt = new Date("2026-07-16T00:00:00.000Z");
    expect(() => assertDemoFeedCreateAvailable(attemptedAt, new Date("2026-07-16T00:00:30.000Z"), env)).toThrowError(
      expect.objectContaining({
        code: "RATE_LIMITED",
        status: 429,
        details: { retryAfterSeconds: 150, cooldownMinutes: 3 },
      }),
    );
    expect(() => assertDemoFeedCreateAvailable(attemptedAt, new Date("2026-07-16T00:03:00.000Z"), env)).not.toThrow();
  });

  it("reserves the configured refresh window and returns a retry duration", () => {
    const env = testEnv({ DEMO_REFRESH_COOLDOWN_MINUTES: 7 });
    const now = new Date("2026-07-16T00:00:00.000Z");
    const reservedUntil = demoRefreshReservation(now, env);
    expect(reservedUntil?.toISOString()).toBe("2026-07-16T00:07:00.000Z");
    expect(() => assertDemoRefreshAvailable(reservedUntil, new Date(now.getTime() + 30_000), env)).toThrowError(
      expect.objectContaining({
        code: "RATE_LIMITED",
        status: 429,
        details: { retryAfterSeconds: 390, cooldownMinutes: 7 },
      }),
    );
  });
});
