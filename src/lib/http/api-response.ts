import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";

export function apiData<T>(data: T, init?: ResponseInit) {
  return Response.json({ data }, init);
}

export function apiError(error: unknown, requestId = randomUUID()) {
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "提交的数据不符合要求。",
          requestId,
          details: error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error({ event: "api.request.failed", requestId, err: error });
    }

    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      { status: error.status },
    );
  }

  logger.error({ event: "api.request.failed", requestId, err: error });

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "服务器暂时无法完成请求。",
        requestId,
      },
    },
    { status: 500 },
  );
}
