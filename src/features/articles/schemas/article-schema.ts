import { z } from "zod";

export const articleFilterSchema = z.object({
  feedId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  query: z.string().trim().max(200).optional(),
  unread: z.coerce.boolean().optional(),
  starred: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const updateArticleStateSchema = z
  .object({
    isRead: z.boolean().optional(),
    isStarred: z.boolean().optional(),
  })
  .refine((value) => value.isRead !== undefined || value.isStarred !== undefined, {
    message: "至少需要更新一种文章状态。",
  });

export type ArticleFilter = z.infer<typeof articleFilterSchema>;
