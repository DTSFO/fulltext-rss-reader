import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { articles, categories, feedCategories, feeds, users } from "@/db/schema";
import {
  assertDemoCapacity,
  assertDemoFeedCreateAvailable,
  assertDemoRefreshAvailable,
  demoRefreshReservation,
  getDemoArticleRetentionLimit,
} from "@/lib/config/demo-policy";
import { getEnv } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors/app-error";
import { normalizeHttpUrl, safeFetchText } from "@/lib/http/safe-fetch";
import { logger } from "@/lib/logging/logger";
import { parseFeedXml, type NormalizedFeed } from "@/lib/rss/normalized-feed";

const FEED_CONTENT_TYPES = ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "text/plain"] as const;
const ARTICLE_UPSERT_BATCH_SIZE = 250;
type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type RefreshSource = "manual" | "scheduled";

export async function listFeeds(userId: string) {
  const [feedRows, categoryRows] = await Promise.all([
    getDb()
      .select({
        id: feeds.id,
        title: feeds.title,
        canonicalUrl: feeds.canonicalUrl,
        siteUrl: feeds.siteUrl,
        iconUrl: feeds.iconUrl,
        lastFetchedAt: feeds.lastFetchedAt,
        lastErrorCode: feeds.lastErrorCode,
        lastErrorMessage: feeds.lastErrorMessage,
      })
      .from(feeds)
      .where(eq(feeds.userId, userId))
      .orderBy(asc(feeds.title)),
    getDb()
      .select({ feedId: feedCategories.feedId, categoryId: feedCategories.categoryId })
      .from(feedCategories)
      .innerJoin(feeds, eq(feeds.id, feedCategories.feedId))
      .where(eq(feeds.userId, userId)),
  ]);

  const categoryIdsByFeed = new Map<string, string[]>();

  for (const row of categoryRows) {
    categoryIdsByFeed.set(row.feedId, [...(categoryIdsByFeed.get(row.feedId) ?? []), row.categoryId]);
  }

  return feedRows.map((feed) => ({ ...feed, categoryIds: categoryIdsByFeed.get(feed.id) ?? [] }));
}

export async function createFeed(userId: string, inputUrl: string, categoryName?: string) {
  const db = getDb();
  const requestedUrl = normalizeHttpUrl(inputUrl).toString();
  await reserveDemoFeedCreation(db, userId);
  const fetched = await fetchAndParseFeed(requestedUrl);
  const canonicalUrl = normalizeHttpUrl(fetched.finalUrl).toString();
  const now = new Date();
  const nextRefreshAt = addMinutes(now, getEnv().FEED_REFRESH_MINUTES);

  try {
    return await db.transaction(async (tx) => {
      await assertFeedCapacity(tx, userId, true);
      const [feed] = await tx
        .insert(feeds)
        .values({
          userId,
          canonicalUrl,
          title: fetched.feed.title,
          siteUrl: fetched.feed.siteUrl,
          description: fetched.feed.description,
          lastFetchedAt: now,
          nextRefreshAt,
          refreshLeaseUntil: demoRefreshReservation(now),
        })
        .onConflictDoNothing({ target: [feeds.userId, feeds.canonicalUrl] })
        .returning();

      if (!feed) {
        throw new AppError({
          code: "FEED_ALREADY_EXISTS",
          message: "该订阅已经添加。",
          status: 409,
        });
      }

      await upsertFeedArticles(tx, feed.id, fetched.feed);

      if (categoryName) {
        const [category] = await tx
          .insert(categories)
          .values({ userId, name: categoryName })
          .onConflictDoUpdate({
            target: [categories.userId, categories.name],
            set: { name: categoryName },
          })
          .returning({ id: categories.id });

        if (category) {
          await tx
            .insert(feedCategories)
            .values({ feedId: feed.id, categoryId: category.id })
            .onConflictDoNothing();
        }
      }

      logger.info({
        event: "feed.created",
        userId,
        feedId: feed.id,
        itemCount: fetched.feed.items.length,
      });

      return feed;
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (isUniqueViolation(error)) {
      throw new AppError({
        code: "FEED_ALREADY_EXISTS",
        message: "该订阅已经添加。",
        status: 409,
        cause: error,
      });
    }

    throw error;
  }
}

export async function refreshFeed(userId: string, feedId: string, source: RefreshSource = "manual") {
  const db = getDb();
  const feed = await loadFeedForRefresh(userId, feedId, source);

  const startedAt = Date.now();

  try {
    const fetched = await fetchAndParseFeed(feed.canonicalUrl);
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(feeds)
        .set({
          title: fetched.feed.title,
          siteUrl: fetched.feed.siteUrl,
          description: fetched.feed.description,
          lastFetchedAt: now,
          nextRefreshAt: addMinutes(now, getEnv().FEED_REFRESH_MINUTES),
          refreshFailures: 0,
          lastErrorCode: null,
          lastErrorMessage: null,
          refreshLeaseUntil: demoRefreshReservation(now),
          updatedAt: now,
        })
        .where(eq(feeds.id, feed.id));

      await upsertFeedArticles(tx, feed.id, fetched.feed);
    });

    logger.info({
      event: "feed.refresh.completed",
      userId,
      feedId: feed.id,
      itemCount: fetched.feed.items.length,
      durationMs: Date.now() - startedAt,
    });

    return { feedId: feed.id, itemCount: fetched.feed.items.length };
  } catch (error) {
    const failures = feed.refreshFailures + 1;
    const retryMinutes = Math.min(30 * 2 ** Math.max(failures - 1, 0), 12 * 60);
    const safeMessage = error instanceof AppError ? error.message : "订阅刷新失败。";
    const safeCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";

    await db
      .update(feeds)
      .set({
        refreshFailures: failures,
        lastErrorCode: safeCode,
        lastErrorMessage: safeMessage,
        nextRefreshAt: addMinutes(new Date(), retryMinutes),
        refreshLeaseUntil: demoRefreshReservation(new Date()),
        updatedAt: new Date(),
      })
      .where(eq(feeds.id, feed.id));

    logger.warn({
      event: "feed.refresh.failed",
      userId,
      feedId: feed.id,
      code: safeCode,
      durationMs: Date.now() - startedAt,
    });

    throw error;
  }
}

async function fetchAndParseFeed(url: string) {
  const response = await safeFetchText(url, {
    accept: FEED_CONTENT_TYPES,
    maxBytes: 5 * 1024 * 1024,
  });

  const maxItems = getDemoArticleRetentionLimit() ?? undefined;
  return { finalUrl: response.finalUrl, feed: parseFeedXml(response.body, response.finalUrl, { maxItems }) };
}

async function upsertFeedArticles(tx: Transaction, feedId: string, feed: NormalizedFeed) {
  if (feed.items.length > 0) {
    const now = new Date();

    for (let offset = 0; offset < feed.items.length; offset += ARTICLE_UPSERT_BATCH_SIZE) {
      const batch = feed.items.slice(offset, offset + ARTICLE_UPSERT_BATCH_SIZE);
      await tx
        .insert(articles)
        .values(
          batch.map((item) => ({
            feedId,
            externalId: item.externalId,
            url: item.url,
            title: item.title,
            author: item.author,
            summary: item.summary,
            feedContentHtml: item.contentHtml,
            publishedAt: item.publishedAt,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [articles.feedId, articles.externalId],
          set: {
            url: sql`excluded.url`,
            title: sql`excluded.title`,
            author: sql`excluded.author`,
            summary: sql`excluded.summary`,
            feedContentHtml: sql`excluded.feed_content_html`,
            publishedAt: sql`excluded.published_at`,
            updatedAt: now,
          },
        });
    }
  }

  const retentionLimit = getDemoArticleRetentionLimit();
  if (retentionLimit === null) return;
  await tx.execute(sql`
    delete from ${articles}
    where ${articles.id} in (
      select ${articles.id}
      from ${articles}
      where ${articles.feedId} = ${feedId}
      order by coalesce(${articles.publishedAt}, ${articles.createdAt}) desc, ${articles.id} desc
      offset ${retentionLimit}
    )
  `);
}

async function assertFeedCapacity(
  db: Pick<ReturnType<typeof getDb>, "$count" | "execute">,
  userId: string,
  lockQuota: boolean,
): Promise<void> {
  if (!getEnv().DEMO_MODE) return;
  if (lockQuota) {
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`demo-feed-quota:${userId}`}, 0))`);
  }
  const feedCount = await db.$count(feeds, eq(feeds.userId, userId));
  assertDemoCapacity("feeds", feedCount);
}

async function reserveDemoFeedCreation(db: ReturnType<typeof getDb>, userId: string): Promise<void> {
  if (!getEnv().DEMO_MODE) return;
  await db.transaction(async (tx) => {
    await assertFeedCapacity(tx, userId, true);
    const [account] = await tx
      .select({ lastFeedCreateAttemptAt: users.updatedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!account) throw new Error("Demo account could not be found.");

    const now = new Date();
    assertDemoFeedCreateAvailable(account.lastFeedCreateAttemptAt, now);
    await tx.update(users).set({ updatedAt: now }).where(eq(users.id, userId));
  });
}

async function loadFeedForRefresh(userId: string, feedId: string, source: RefreshSource) {
  const db = getDb();
  if (source === "manual" && getEnv().DEMO_MODE) {
    return db.transaction(async (tx) => {
      const [feed] = await tx
        .select()
        .from(feeds)
        .where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
        .limit(1)
        .for("update");
      assertFeedFound(feed);
      const now = new Date();
      assertDemoRefreshAvailable(feed.refreshLeaseUntil, now);
      await tx
        .update(feeds)
        .set({ refreshLeaseUntil: demoRefreshReservation(now), updatedAt: now })
        .where(eq(feeds.id, feed.id));
      return feed;
    });
  }

  const [feed] = await db
    .select()
    .from(feeds)
    .where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
    .limit(1);
  assertFeedFound(feed);
  return feed;
}

function assertFeedFound<T>(feed: T | undefined): asserts feed is T {
  if (feed) return;
  throw new AppError({
    code: "FEED_NOT_FOUND",
    message: "没有找到该订阅。",
    status: 404,
  });
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
