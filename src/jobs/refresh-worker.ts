import { sql } from "drizzle-orm";

import { prefetchNewestArticles } from "@/features/articles/server/article-service";
import { refreshFeed } from "@/features/feeds/server/feed-service";
import { getEnv } from "@/lib/config/env";
import { closeDb, getDb } from "@/lib/db/client";
import { logger } from "@/lib/logging/logger";

const IDLE_POLL_MS = 30_000;
const ACTIVE_POLL_MS = 5_000;

let isStopping = false;

process.on("SIGTERM", () => {
  isStopping = true;
});

process.on("SIGINT", () => {
  isStopping = true;
});

async function main() {
  logger.info({ event: "worker.started" });

  while (!isStopping) {
    const claimedFeeds = await claimDueFeeds();

    if (claimedFeeds.length > 0) {
      const results = await Promise.allSettled(
        claimedFeeds.map(processFeed),
      );
      const failedCount = results.filter((result) => result.status === "rejected").length;

      logger.info({
        event: "worker.batch.completed",
        feedCount: claimedFeeds.length,
        failedCount,
      });
    }

    await delay(claimedFeeds.length > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  }

  await closeDb();
  logger.info({ event: "worker.stopped" });
}

async function processFeed(feed: { id: string; userId: string }) {
  await refreshFeed(feed.userId, feed.id, "scheduled");
  await prefetchNewestArticles(feed.userId, feed.id, getEnv().FULL_TEXT_PREFETCH_COUNT);
}

async function claimDueFeeds() {
  const rows = await getDb().execute<{ id: string; userId: string }>(sql`
    update feeds
    set refresh_lease_until = now() + interval '2 minutes',
        updated_at = now()
    where id in (
      select id
      from feeds
      where next_refresh_at <= now()
        and (refresh_lease_until is null or refresh_lease_until < now())
      order by next_refresh_at asc
      for update skip locked
      limit ${getEnv().REFRESH_BATCH_SIZE}
    )
    returning id, user_id as "userId"
  `);

  return Array.from(rows);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch(async (error: unknown) => {
  logger.error({ event: "worker.crashed", err: error });
  await closeDb();
  process.exitCode = 1;
});
