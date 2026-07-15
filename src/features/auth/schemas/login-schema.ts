import { z } from "zod";

export const loginInputSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名。"),
  password: z.string().min(1, "请输入密码。"),
});

export const loginDataSchema = z.object({
  user: z.object({ id: z.uuid(), username: z.string() }),
});

export const signedOutDataSchema = z.object({ signedOut: z.literal(true) });

export type LoginInput = z.infer<typeof loginInputSchema>;
