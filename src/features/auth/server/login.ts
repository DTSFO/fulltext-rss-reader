import "server-only";

import { verify } from "@node-rs/argon2";

import { loginInputSchema, type LoginInput } from "@/features/auth/schemas/login-schema";
import { ensureConfiguredUser } from "@/features/auth/server/user-service";
import { createSession } from "@/features/auth/server/session";
import { getEnv } from "@/lib/config/env";
import { AppError } from "@/lib/errors/app-error";

export async function login(input: LoginInput) {
  const credentials = loginInputSchema.parse(input);
  const env = getEnv();

  const usernameMatches = credentials.username === env.SINGLE_USER_USERNAME;
  const passwordMatches = usernameMatches
    ? await verify(env.SINGLE_USER_PASSWORD_HASH, credentials.password)
    : false;

  if (!usernameMatches || !passwordMatches) {
    throw new AppError({
      code: "INVALID_CREDENTIALS",
      message: "用户名或密码不正确。",
      status: 401,
    });
  }

  const user = await ensureConfiguredUser();
  await createSession(user);

  return user;
}
