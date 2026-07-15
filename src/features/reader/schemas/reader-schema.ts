import { z } from "zod";

export const feedListItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  canonicalUrl: z.url(),
  siteUrl: z.url().nullable(),
  iconUrl: z.url().nullable(),
  lastFetchedAt: z.iso.datetime().nullable(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  categoryIds: z.array(z.uuid()),
});

export const categoryListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  feedCount: z.number().int().nonnegative(),
});

export const articleListItemSchema = z.object({
  id: z.uuid(),
  feedId: z.uuid(),
  feedTitle: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  summary: z.string().nullable(),
  url: z.url(),
  publishedAt: z.iso.datetime().nullable(),
  sortDate: z.iso.datetime(),
  isRead: z.boolean(),
  isStarred: z.boolean(),
});

export const articleDetailSchema = articleListItemSchema.extend({
  feedContentHtml: z.string().nullable(),
  extractedContentHtml: z.string().nullable(),
  extractionStatus: z.string(),
  contentHtml: z.string().nullable(),
  usedFallback: z.boolean(),
});

export const feedListDataSchema = z.object({ feeds: z.array(feedListItemSchema) });
export const categoryListDataSchema = z.object({ categories: z.array(categoryListItemSchema) });
export const articlePageSchema = z.object({
  items: z.array(articleListItemSchema),
  nextCursor: z.string().nullable(),
});
export const articleDetailDataSchema = z.object({ article: articleDetailSchema });
export const articleStateDataSchema = z.object({
  state: z.object({ isRead: z.boolean(), isStarred: z.boolean() }),
});
export const createdFeedDataSchema = z.object({ feed: z.object({ id: z.uuid() }).passthrough() });
export const refreshFeedDataSchema = z.object({ feedId: z.uuid(), itemCount: z.number().int().nonnegative() });
export type FeedListItem = z.infer<typeof feedListItemSchema>;
export type CategoryListItem = z.infer<typeof categoryListItemSchema>;
export type ArticleListItem = z.infer<typeof articleListItemSchema>;
export type ArticleDetail = z.infer<typeof articleDetailSchema>;
export type ArticlePage = z.infer<typeof articlePageSchema>;
