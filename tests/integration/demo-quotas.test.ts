import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { safeFetchTextMock } = vi.hoisted(() => ({ safeFetchTextMock: vi.fn() }));

vi.mock("@/lib/http/safe-fetch", () => ({
  normalizeHttpUrl(input: string) {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported URL protocol.");
    return url;
  },
  safeFetchText: safeFetchTextMock,
}));

import { appearanceThemes, articles, feeds, users } from "@/db/schema";
import { acquireAppearanceLeases } from "@/features/appearance/server/appearance-db";
import { createAppearanceTheme } from "@/features/appearance/server/appearance-mutation-service";
import {
  confirmAppearanceRestore,
  exportAppearancePackage,
  exportAppearanceTheme,
  importAppearanceTheme,
  previewAppearanceRestore,
} from "@/features/appearance/server/appearance-transfer-service";
import { createFeed, refreshFeed } from "@/features/feeds/server/feed-service";
import { BUILTIN_THEMES } from "@/features/appearance/theme-contract";
import { resetEnvCacheForTests } from "@/lib/config/env";
import { closeDb, getDb } from "@/lib/db/client";

const TOKEN = "d".repeat(64);
const DEMO_ENV_KEYS = [
  "DEMO_MODE",
  "DEMO_MAX_FEEDS",
  "DEMO_MAX_THEMES",
  "DEMO_MAX_ARTICLES_PER_FEED",
  "DEMO_FEED_CREATE_COOLDOWN_MINUTES",
  "DEMO_REFRESH_COOLDOWN_MINUTES",
] as const;
const originalDemoEnv = Object.fromEntries(DEMO_ENV_KEYS.map((key) => [key, process.env[key]]));
let accountId = "";

const feedXml = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Demo feed</title><link>https://example.com/</link>
  <item><guid>oldest</guid><title>Oldest</title><link>https://example.com/oldest</link><pubDate>Mon, 13 Jul 2026 00:00:00 GMT</pubDate></item>
  <item><guid>middle</guid><title>Middle</title><link>https://example.com/middle</link><pubDate>Tue, 14 Jul 2026 00:00:00 GMT</pubDate></item>
  <item><guid>second-newest</guid><title>Second newest</title><link>https://example.com/second</link><pubDate>Wed, 15 Jul 2026 00:00:00 GMT</pubDate></item>
  <item><guid>newest</guid><title>Newest</title><link>https://example.com/newest</link><pubDate>Thu, 16 Jul 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

function configureDemo(overrides: Partial<Record<(typeof DEMO_ENV_KEYS)[number], string>> = {}) {
  Object.assign(process.env, {
    DEMO_MODE: "true",
    DEMO_MAX_FEEDS: "2",
    DEMO_MAX_THEMES: "2",
    DEMO_MAX_ARTICLES_PER_FEED: "2",
    DEMO_FEED_CREATE_COOLDOWN_MINUTES: "1",
    DEMO_REFRESH_COOLDOWN_MINUTES: "10",
    ...overrides,
  });
  resetEnvCacheForTests();
}

async function createTheme(name: string) {
  return createAppearanceTheme(accountId, {
    operationId: crypto.randomUUID(),
    holderToken: TOKEN,
    name,
    declaredScheme: "light",
    source: { kind: "builtin", scheme: "light" },
    validationCanvas: BUILTIN_THEMES.light.validationCanvas,
    browserValidation: null,
    keepLease: false,
  });
}

beforeAll(() => {
  configureDemo();
});

beforeEach(async () => {
  configureDemo();
  safeFetchTextMock.mockReset();
  safeFetchTextMock.mockImplementation(async (url: string) => ({ finalUrl: url, body: feedXml }));
  const [account] = await getDb()
    .insert(users)
    .values({
      username: `demo-quota-${crypto.randomUUID()}`,
      updatedAt: new Date(Date.now() - 60 * 60_000),
    })
    .returning({ id: users.id });
  if (!account) throw new Error("Could not create demo quota test account.");
  accountId = account.id;
});

afterEach(async () => {
  if (accountId) await getDb().delete(users).where(eq(users.id, accountId));
});

afterAll(async () => {
  await closeDb();
  for (const key of DEMO_ENV_KEYS) {
    const value = originalDemoEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCacheForTests();
});

describe("hosted demo quotas", () => {
  it("retains only the newest articles and cools down manual refreshes without blocking the worker path", async () => {
    const feed = await createFeed(accountId, "https://feeds.example.test/one.xml");
    const stored = await getDb()
      .select({ title: articles.title })
      .from(articles)
      .where(eq(articles.feedId, feed.id))
      .orderBy(asc(articles.title));
    expect(stored.map((row) => row.title)).toEqual(["Newest", "Second newest"]);

    await expect(refreshFeed(accountId, feed.id)).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(safeFetchTextMock).toHaveBeenCalledTimes(1);

    await expect(refreshFeed(accountId, feed.id, "scheduled")).resolves.toMatchObject({ feedId: feed.id, itemCount: 2 });
    expect(safeFetchTextMock).toHaveBeenCalledTimes(2);
    expect(await getDb().$count(articles, eq(articles.feedId, feed.id))).toBe(2);
  });

  it("bounds oversized feeds before insertion and writes the retained items in batches", async () => {
    configureDemo({ DEMO_MAX_ARTICLES_PER_FEED: "300" });
    const items = Array.from({ length: 600 }, (_, index) => {
      const itemNumber = index + 1;
      return `<item><guid>item-${itemNumber}</guid><title>Item ${itemNumber}</title><link>https://example.com/${itemNumber}</link><pubDate>${new Date(Date.UTC(2026, 0, itemNumber)).toUTCString()}</pubDate></item>`;
    }).join("");
    safeFetchTextMock.mockImplementation(async (url: string) => ({
      finalUrl: url,
      body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Oversized</title>${items}</channel></rss>`,
    }));

    const feed = await createFeed(accountId, "https://feeds.example.test/oversized.xml");
    const stored = await getDb()
      .select({ externalId: articles.externalId })
      .from(articles)
      .where(eq(articles.feedId, feed.id));

    expect(stored).toHaveLength(300);
    expect(new Set(stored.map((row) => row.externalId))).toEqual(
      new Set(Array.from({ length: 300 }, (_, index) => `item-${index + 301}`)),
    );
  });

  it("atomically reserves account-level creation cooldowns before fetching", async () => {
    const results = await Promise.allSettled([
      createFeed(accountId, "https://feeds.example.test/a.xml"),
      createFeed(accountId, "https://feeds.example.test/b.xml"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected && rejected.status === "rejected" ? rejected.reason : null).toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    expect(safeFetchTextMock).toHaveBeenCalledTimes(1);
    expect(await getDb().$count(feeds, eq(feeds.userId, accountId))).toBe(1);
  });

  it("keeps creation cooldown state after a feed is deleted", async () => {
    const first = await createFeed(accountId, "https://feeds.example.test/first.xml");
    await getDb().delete(feeds).where(eq(feeds.id, first.id));

    await expect(createFeed(accountId, "https://feeds.example.test/readded.xml")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    expect(safeFetchTextMock).toHaveBeenCalledTimes(1);
    expect(await getDb().$count(feeds, eq(feeds.userId, accountId))).toBe(0);
  });

  it("rejects feed creation at quota before fetching", async () => {
    configureDemo({ DEMO_MAX_FEEDS: "1" });
    await getDb().insert(feeds).values({
      userId: accountId,
      canonicalUrl: "https://feeds.example.test/existing.xml",
      title: "Existing feed",
    });

    await expect(createFeed(accountId, "https://feeds.example.test/blocked.xml")).rejects.toMatchObject({
      code: "DEMO_LIMIT_REACHED",
      details: { resource: "feeds", limit: 1 },
    });
    expect(safeFetchTextMock).not.toHaveBeenCalled();
  });

  it("enforces theme limits for create, import, restore preview, and final restore", async () => {
    const first = await createTheme("First demo theme");
    await createTheme("Second demo theme");
    if ("kind" in first) throw new Error("Initial theme create unexpectedly replayed.");

    await expect(createTheme("Third demo theme")).rejects.toMatchObject({
      code: "DEMO_LIMIT_REACHED",
      details: { resource: "themes", limit: 2 },
    });

    const themeFile = await exportAppearanceTheme(accountId, first.theme.id);
    await expect(importAppearanceTheme(accountId, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN,
      file: themeFile,
      editAfterImport: false,
    })).rejects.toMatchObject({ code: "DEMO_LIMIT_REACHED" });

    const basePackage = await exportAppearancePackage(accountId);
    const sourceTheme = basePackage.themes[0];
    if (!sourceTheme) throw new Error("Expected an exported demo theme.");
    const overLimitPackage = {
      ...basePackage,
      themes: [
        ...basePackage.themes,
        { ...sourceTheme, portableId: "theme-extra", name: "Extra restored theme" },
      ],
    };
    await expect(previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file: overLimitPackage,
    })).rejects.toMatchObject({ code: "DEMO_LIMIT_REACHED" });

    configureDemo({ DEMO_MAX_THEMES: "3" });
    const preview = await previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file: overLimitPackage,
    });
    const [root] = await acquireAppearanceLeases(accountId, TOKEN, [{ kind: "root" }]);
    if (!root) throw new Error("Expected a restore root lease.");
    configureDemo({ DEMO_MAX_THEMES: "2" });
    await expect(confirmAppearanceRestore(accountId, preview.planId, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN,
      handle: root,
      payloadDigest: preview.payloadDigest,
      expectedStateRevision: preview.expectedStateRevision,
    })).rejects.toMatchObject({ code: "DEMO_LIMIT_REACHED" });
    expect(await getDb().$count(appearanceThemes, eq(appearanceThemes.accountId, accountId))).toBe(2);
  });
});
