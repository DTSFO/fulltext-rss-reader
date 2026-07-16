import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";

import { AppError } from "@/lib/errors/app-error";

export const normalizedFeedItemSchema = z.object({
  externalId: z.string().min(1),
  url: z.url(),
  title: z.string().min(1),
  author: z.string().nullable(),
  summary: z.string().nullable(),
  contentHtml: z.string().nullable(),
  publishedAt: z.date().nullable(),
});

export const normalizedFeedSchema = z.object({
  title: z.string().min(1),
  siteUrl: z.url().nullable(),
  description: z.string().nullable(),
  items: z.array(normalizedFeedItemSchema),
});

export type NormalizedFeed = z.infer<typeof normalizedFeedSchema>;
export type NormalizedFeedItem = z.infer<typeof normalizedFeedItemSchema>;

type ParseFeedOptions = {
  maxItems?: number;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  textNodeName: "#text",
  cdataPropName: "#cdata",
  trimValues: true,
});

const feedHtmlOptions: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "a", "blockquote", "ul", "ol", "li", "code", "pre", "h2", "h3", "h4", "img"],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
  },
  allowedSchemes: ["http", "https", "mailto"],
};

export function parseFeedXml(xml: string, sourceUrl: string, options: ParseFeedOptions = {}): NormalizedFeed {
  let document: unknown;

  try {
    document = parser.parse(xml);
  } catch (error) {
    throw feedParseError(error);
  }

  if (!document || typeof document !== "object") {
    throw feedParseError();
  }

  const record = document as Record<string, unknown>;

  if (isRecord(record.rss)) {
    return parseRss(record.rss, sourceUrl, options);
  }

  if (isRecord(record.feed)) {
    return parseAtom(record.feed, sourceUrl, options);
  }

  throw feedParseError();
}

function parseRss(rss: Record<string, unknown>, sourceUrl: string, options: ParseFeedOptions): NormalizedFeed {
  const channel = isRecord(rss.channel) ? rss.channel : undefined;

  if (!channel) {
    throw feedParseError();
  }

  const siteUrl = resolveOptionalUrl(readText(channel.link), sourceUrl);
  const items = selectNewestRecords(
    channel.item,
    options.maxItems,
    (item) => parseDate(readText(item.pubDate) ?? readText(item.date)),
  )
    .map((item) => normalizeItem({
      externalId: readText(item.guid),
      url: resolveRequiredUrl(readText(item.link), sourceUrl),
      title: readText(item.title),
      author: readText(item.creator) ?? readText(item.author),
      summary: readText(item.description),
      contentHtml: readText(item.encoded) ?? readText(item.description),
      publishedAt: parseDate(readText(item.pubDate) ?? readText(item.date)),
    }));

  return normalizedFeedSchema.parse({
    title: readText(channel.title) ?? new URL(sourceUrl).hostname,
    siteUrl,
    description: readText(channel.description) ?? null,
    items,
  });
}

function parseAtom(feed: Record<string, unknown>, sourceUrl: string, options: ParseFeedOptions): NormalizedFeed {
  const siteUrl = findAtomLink(feed.link, sourceUrl, "alternate");
  const items = selectNewestRecords(
    feed.entry,
    options.maxItems,
    (entry) => parseDate(readText(entry.published) ?? readText(entry.updated)),
  )
    .map((entry) => {
      const url = findAtomLink(entry.link, sourceUrl, "alternate");
      const content = readText(entry.content) ?? readText(entry.summary);

      return normalizeItem({
        externalId: readText(entry.id),
        url: url ?? resolveRequiredUrl(readText(entry.id), sourceUrl),
        title: readText(entry.title),
        author: readAuthor(entry.author),
        summary: readText(entry.summary),
        contentHtml: content,
        publishedAt: parseDate(readText(entry.published) ?? readText(entry.updated)),
      });
    });

  return normalizedFeedSchema.parse({
    title: readText(feed.title) ?? new URL(sourceUrl).hostname,
    siteUrl,
    description: readText(feed.subtitle) ?? null,
    items,
  });
}

function normalizeItem(input: {
  externalId?: string;
  url: string;
  title?: string;
  author?: string;
  summary?: string;
  contentHtml?: string;
  publishedAt: Date | null;
}): NormalizedFeedItem {
  const sanitizedContent = input.contentHtml ? sanitizeHtml(input.contentHtml, feedHtmlOptions) : null;
  const summary = input.summary ? sanitizeHtml(input.summary, { allowedTags: [] }).trim() || null : null;
  const title = input.title?.trim() || "无标题文章";
  const externalId = input.externalId?.trim() || createHash("sha256")
    .update([input.url, title, input.publishedAt?.toISOString() ?? "", summary ?? ""].join("\u0000"))
    .digest("hex");

  return normalizedFeedItemSchema.parse({
    externalId,
    url: input.url,
    title,
    author: input.author?.trim() || null,
    summary,
    contentHtml: sanitizedContent || null,
    publishedAt: input.publishedAt,
  });
}

function findAtomLink(value: unknown, sourceUrl: string, preferredRel: string) {
  const links = toArray(value);
  const preferred = links.find((link) => isRecord(link) && (!readText(link.rel) || readText(link.rel) === preferredRel));
  const candidate = preferred ?? links[0];

  if (isRecord(candidate)) {
    return resolveOptionalUrl(readText(candidate.href) ?? readText(candidate["#text"]), sourceUrl);
  }

  return resolveOptionalUrl(readText(candidate), sourceUrl);
}

function readAuthor(value: unknown) {
  const author = toArray(value)[0];

  if (isRecord(author)) {
    return readText(author.name) ?? readText(author.email);
  }

  return readText(author);
}

function readText(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim() || undefined;
  }

  if (isRecord(value)) {
    return readText(value["#text"]) ?? readText(value["#cdata"]);
  }

  return undefined;
}

function resolveRequiredUrl(value: string | undefined, sourceUrl: string) {
  const resolved = resolveOptionalUrl(value, sourceUrl);

  if (!resolved) {
    throw feedParseError();
  }

  return resolved;
}

function resolveOptionalUrl(value: string | undefined, sourceUrl: string) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, sourceUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function selectNewestRecords(
  value: unknown,
  maxItems: number | undefined,
  readPublishedAt: (record: Record<string, unknown>) => Date | null,
): Record<string, unknown>[] {
  const records = toArray(value).filter(isRecord);
  if (maxItems === undefined || records.length <= maxItems) return records;
  if (maxItems <= 0) return [];

  return records
    .map((record, index) => ({ record, index, publishedAt: readPublishedAt(record)?.getTime() ?? Number.NEGATIVE_INFINITY }))
    .sort((left, right) => right.publishedAt - left.publishedAt || left.index - right.index)
    .slice(0, maxItems)
    .map(({ record }) => record);
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function feedParseError(cause?: unknown) {
  return new AppError({
    code: "FEED_PARSE_FAILED",
    message: "无法解析该 RSS 或 Atom 订阅源。",
    status: 422,
    cause,
  });
}
