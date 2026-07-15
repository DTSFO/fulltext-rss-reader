import "server-only";

import { getEnv } from "@/lib/config/env";
import { AppError } from "@/lib/errors/app-error";

export function requireSameOriginMutation(request: Request): void {
  const expectedOrigin = new URL(getEnv().APP_URL).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite === "cross-site" || origin !== expectedOrigin) {
    throw new AppError({
      code: "FORBIDDEN",
      message: "该外观操作未通过同源校验。",
      status: 403,
    });
  }
}
