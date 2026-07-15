import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { feeds } from "./feeds";
import { users } from "./users";

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedId: uuid("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    summary: text("summary"),
    feedContentHtml: text("feed_content_html"),
    extractedContentHtml: text("extracted_content_html"),
    extractionStatus: text("extraction_status").default("pending").notNull(),
    extractionErrorCode: text("extraction_error_code"),
    extractionAttemptedAt: timestamp("extraction_attempted_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("articles_feed_external_id_unique").on(table.feedId, table.externalId),
    index("articles_feed_published_idx").on(table.feedId, table.publishedAt, table.id),
  ],
);

export const articleStates = pgTable(
  "article_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    isRead: boolean("is_read").default(false).notNull(),
    isStarred: boolean("is_starred").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    starredAt: timestamp("starred_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("article_states_user_article_unique").on(table.userId, table.articleId),
    index("article_states_user_unread_idx").on(table.userId, table.isRead),
    index("article_states_user_starred_idx").on(table.userId, table.isStarred),
  ],
);
