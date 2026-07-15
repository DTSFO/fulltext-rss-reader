import { z } from "zod";

export const createFeedInputSchema = z.object({
  url: z.string().trim().min(1, "请输入订阅地址。"),
  categoryName: z.string().trim().min(1).max(80).optional(),
});

export type CreateFeedInput = z.infer<typeof createFeedInputSchema>;
