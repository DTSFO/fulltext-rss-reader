import { z } from "zod";

export const createCategoryInputSchema = z.object({
  name: z.string().trim().min(1, "请输入分类名称。").max(80),
});
