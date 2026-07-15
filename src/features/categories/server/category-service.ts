import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { categories, feedCategories, feeds } from "@/db/schema";
import { getDb } from "@/lib/db/client";

export async function listCategories(userId: string) {
  return getDb()
    .select({
      id: categories.id,
      name: categories.name,
      feedCount: sql<number>`count(${feedCategories.feedId})::int`,
    })
    .from(categories)
    .leftJoin(feedCategories, eq(feedCategories.categoryId, categories.id))
    .where(eq(categories.userId, userId))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));
}

export async function createCategory(userId: string, name: string) {
  const [category] = await getDb()
    .insert(categories)
    .values({ userId, name })
    .onConflictDoUpdate({
      target: [categories.userId, categories.name],
      set: { name },
    })
    .returning({ id: categories.id, name: categories.name });

  return category;
}

export async function listFeedCategoryIds(userId: string) {
  return getDb()
    .select({ feedId: feedCategories.feedId, categoryId: feedCategories.categoryId })
    .from(feedCategories)
    .innerJoin(feeds, eq(feeds.id, feedCategories.feedId))
    .where(eq(feeds.userId, userId));
}
