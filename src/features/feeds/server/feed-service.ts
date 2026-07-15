import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { articles, categories, feedCategories, feeds } from "@/db/schema";
import { getEnv } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors/app-error";
import { normalizeHttpUrl, safeFetchText } from "@/lib/http/safe-fetch";
import { logger } from "@/lib/logging/logger";
import { parseFeedXml, type NormalizedFeed } from "@/lib/rss/normalized-feed";

const FEED_CONTENT_TYPES = ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "text/plain"] as const;

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
  const requestedUrl = normalizeHttpUrl(inputUrl).toString();
  const fetched = await fetchAndParseFeed(requestedUrl);
  const canonicalUrl = normalizeHttpUrl(fetched.finalUrl).toString();
  const now = new Date();
  const nextRefreshAt = addMinutes(now, getEnv().FEED_REFRESH_MINUTES);
  const db = getDb();

  try {
    return await db.transaction(async (tx) => {
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

export async function refreshFeed(userId: string, feedId: string) {
  const db = getDb();
  const [feed] = await db
    .select()
    .from(feeds)
    .where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
    .limit(1);

  if (!feed) {
    throw new AppError({
      code: "FEED_NOT_FOUND",
      message: "没有找到该订阅。",
      status: 404,
    });
  }

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
          refreshLeaseUntil: null,
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
        refreshLeaseUntil: null,
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

  return { finalUrl: response.finalUrl, feed: parseFeedXml(response.body, response.finalUrl) };
}

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function upsertFeedArticles(tx: Transaction, feedId: string, feed: NormalizedFeed) {
  if (feed.items.length === 0) {
    return;
  }

  const now = new Date();

  await tx
    .insert(articles)
    .values(
      feed.items.map((item) => ({
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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
