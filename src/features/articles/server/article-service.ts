import "server-only";

import { Readability } from "@mozilla/readability";
import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { JSDOM } from "jsdom";
import sanitizeHtml from "sanitize-html";

import { articles, articleStates, feedCategories, feeds } from "@/db/schema";
import { type ArticleFilter } from "@/features/articles/schemas/article-schema";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors/app-error";
import { assertPublicHttpUrl, safeFetchText } from "@/lib/http/safe-fetch";

const articleHtmlOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "strong", "b", "em", "i", "a", "blockquote", "ul", "ol", "li", "code", "pre",
    "h1", "h2", "h3", "h4", "h5", "hr", "figure", "figcaption", "img", "table", "thead", "tbody",
    "tr", "th", "td", "sup", "sub", "del", "mark",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
};

const sortDate = sql<Date>`coalesce(${articles.publishedAt}, ${articles.createdAt})`.mapWith(articles.publishedAt);

export async function listArticles(userId: string, filter: ArticleFilter) {
  const cursor = decodeCursor(filter.cursor);
  const conditions = [eq(feeds.userId, userId)];

  if (filter.feedId) {
    conditions.push(eq(articles.feedId, filter.feedId));
  }

  if (filter.categoryId) {
    conditions.push(sql<boolean>`exists (
      select 1 from ${feedCategories}
      where ${feedCategories.feedId} = ${feeds.id}
        and ${feedCategories.categoryId} = ${filter.categoryId}
    )`);
  }

  if (filter.query) {
    const pattern = `%${filter.query}%`;
    conditions.push(or(ilike(articles.title, pattern), ilike(articles.author, pattern), ilike(articles.summary, pattern))!);
  }

  if (filter.unread) {
    conditions.push(sql<boolean>`coalesce(${articleStates.isRead}, false) = false`);
  }

  if (filter.starred) {
    conditions.push(sql<boolean>`coalesce(${articleStates.isStarred}, false) = true`);
  }

  if (cursor) {
    conditions.push(
      or(
        lt(sortDate, cursor.date),
        and(eq(sortDate, cursor.date), lt(articles.id, cursor.id)),
      )!,
    );
  }

  const rows = await getDb()
    .select({
      id: articles.id,
      feedId: articles.feedId,
      feedTitle: feeds.title,
      title: articles.title,
      author: articles.author,
      summary: articles.summary,
      url: articles.url,
      publishedAt: articles.publishedAt,
      sortDate,
      isRead: sql<boolean>`coalesce(${articleStates.isRead}, false)`,
      isStarred: sql<boolean>`coalesce(${articleStates.isStarred}, false)`,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .leftJoin(articleStates, and(eq(articleStates.articleId, articles.id), eq(articleStates.userId, userId)))
    .where(and(...conditions))
    .orderBy(desc(sortDate), desc(articles.id))
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const items = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = items.at(-1);

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.sortDate, last.id) : null,
  };
}

export async function prefetchNewestArticles(userId: string, feedId: string, limit: number) {
  if (limit === 0) {
    return;
  }

  const rows = await getDb()
    .select({ id: articles.id })
    .from(articles)
    .innerJoin(feeds, and(eq(feeds.id, articles.feedId), eq(feeds.userId, userId)))
    .where(and(eq(articles.feedId, feedId), eq(articles.extractionStatus, "pending")))
    .orderBy(desc(sortDate), desc(articles.id))
    .limit(limit);

  await Promise.allSettled(rows.map((row) => getArticle(userId, row.id)));
}

export async function getArticle(userId: string, articleId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: articles.id,
      feedId: articles.feedId,
      feedTitle: feeds.title,
      title: articles.title,
      author: articles.author,
      summary: articles.summary,
      url: articles.url,
      feedContentHtml: articles.feedContentHtml,
      extractedContentHtml: articles.extractedContentHtml,
      extractionStatus: articles.extractionStatus,
      extractionAttemptedAt: articles.extractionAttemptedAt,
      publishedAt: articles.publishedAt,
      sortDate,
      isRead: sql<boolean>`coalesce(${articleStates.isRead}, false)`,
      isStarred: sql<boolean>`coalesce(${articleStates.isStarred}, false)`,
    })
    .from(articles)
    .innerJoin(feeds, and(eq(feeds.id, articles.feedId), eq(feeds.userId, userId)))
    .leftJoin(articleStates, and(eq(articleStates.articleId, articles.id), eq(articleStates.userId, userId)))
    .where(eq(articles.id, articleId))
    .limit(1);

  if (!row) {
    throw articleNotFoundError();
  }

  const retryAfter = row.extractionAttemptedAt
    ? new Date(row.extractionAttemptedAt.getTime() + 24 * 60 * 60 * 1000)
    : null;

  if (row.extractedContentHtml || (row.extractionStatus === "failed" && retryAfter && retryAfter > new Date())) {
    return articleView(row);
  }

  try {
    const extractedContentHtml = await extractArticleHtml(row.url);

    await db
      .update(articles)
      .set({
        extractedContentHtml,
        extractionStatus: "complete",
        extractionErrorCode: null,
        extractionAttemptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(articles.id, row.id));

    return articleView({ ...row, extractedContentHtml, extractionStatus: "complete" });
  } catch (error) {
    await db
      .update(articles)
      .set({
        extractionStatus: "failed",
        extractionErrorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        extractionAttemptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(articles.id, row.id));

    return articleView({ ...row, extractionStatus: "failed" });
  }
}

export async function updateArticleState(
  userId: string,
  articleId: string,
  input: { isRead?: boolean; isStarred?: boolean },
) {
  const db = getDb();
  const [ownedArticle] = await db
    .select({ id: articles.id })
    .from(articles)
    .innerJoin(feeds, and(eq(feeds.id, articles.feedId), eq(feeds.userId, userId)))
    .where(eq(articles.id, articleId))
    .limit(1);

  if (!ownedArticle) {
    throw articleNotFoundError();
  }

  const now = new Date();
  const [state] = await db
    .insert(articleStates)
    .values({
      userId,
      articleId,
      isRead: input.isRead ?? false,
      isStarred: input.isStarred ?? false,
      readAt: input.isRead ? now : null,
      starredAt: input.isStarred ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [articleStates.userId, articleStates.articleId],
      set: {
        ...(input.isRead === undefined ? {} : { isRead: input.isRead, readAt: input.isRead ? now : null }),
        ...(input.isStarred === undefined
          ? {}
          : { isStarred: input.isStarred, starredAt: input.isStarred ? now : null }),
        updatedAt: now,
      },
    })
    .returning({
      isRead: articleStates.isRead,
      isStarred: articleStates.isStarred,
    });

  return state;
}

async function extractArticleHtml(url: string) {
  const response = await safeFetchText(url, {
    accept: ["text/html", "application/xhtml+xml", "text/plain"],
    maxBytes: 8 * 1024 * 1024,
    timeoutMs: 15_000,
  });
  const dom = new JSDOM(response.body, { url: response.finalUrl });

  for (const element of dom.window.document.querySelectorAll<HTMLElement>("[href], [src]")) {
    for (const attribute of ["href", "src"] as const) {
      const value = element.getAttribute(attribute);

      if (value) {
        try {
          element.setAttribute(attribute, new URL(value, response.finalUrl).toString());
        } catch {
          element.removeAttribute(attribute);
        }
      }
    }
  }

  const readable = new Readability(dom.window.document).parse();

  if (!readable?.content) {
    throw new AppError({
      code: "FEED_PARSE_FAILED",
      message: "无法从原网页提取正文。",
      status: 422,
    });
  }

  const contentDocument = new JSDOM(readable.content, { url: response.finalUrl }).window.document;

  await Promise.all(
    Array.from(contentDocument.querySelectorAll("img[src]")).map(async (image) => {
      const source = image.getAttribute("src");

      if (!source) {
        return;
      }

      try {
        image.setAttribute("src", (await assertPublicHttpUrl(source)).toString());
        image.setAttribute("loading", "lazy");
      } catch {
        image.remove();
      }
    }),
  );

  return sanitizeHtml(contentDocument.body.innerHTML, articleHtmlOptions);
}

function articleView(row: {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  author: string | null;
  summary: string | null;
  url: string;
  feedContentHtml: string | null;
  extractedContentHtml: string | null;
  extractionStatus: string;
  extractionAttemptedAt?: Date | null;
  publishedAt: Date | null;
  sortDate: Date;
  isRead: boolean;
  isStarred: boolean;
}) {
  return {
    ...row,
    contentHtml: row.extractedContentHtml ?? row.feedContentHtml,
    usedFallback: !row.extractedContentHtml,
  };
}

function encodeCursor(date: Date, id: string) {
  return Buffer.from(JSON.stringify({ date: date.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) {
    return null;
  }

  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;

    if (!value || typeof value !== "object" || !("date" in value) || !("id" in value)) {
      return null;
    }

    const date = new Date(String(value.date));
    const id = String(value.id);
    return Number.isNaN(date.valueOf()) || !id ? null : { date, id };
  } catch {
    return null;
  }
}

function articleNotFoundError() {
  return new AppError({
    code: "ARTICLE_NOT_FOUND",
    message: "没有找到该文章。",
    status: 404,
  });
}
