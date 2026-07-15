import "server-only";

import { JSONParser } from "@streamparser/json";

import { AppError } from "@/lib/errors/app-error";

function invalidJsonError(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "请求体不是有效的 UTF-8 JSON。",
    status: 400,
  });
}

export async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new AppError({ code: "PAYLOAD_TOO_LARGE", message: "请求体超过部署技术限制。", status: 413 });
  }
  if (!request.body) return null;

  const reader = request.body.getReader();
  const parser = new JSONParser({
    paths: ["$"],
    keepStack: true,
    stringBufferSize: 64 * 1024,
    numberBufferSize: 64,
  });
  let size = 0;
  let parsedRoot: unknown;
  let rootSeen = false;
  parser.onValue = ({ value, parent, stack }) => {
    if (parent !== undefined || stack.length !== 0) return;
    parsedRoot = value;
    rootSeen = true;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new AppError({ code: "PAYLOAD_TOO_LARGE", message: "请求体超过部署技术限制。", status: 413 });
      }
      parser.write(value);
    }
    if (!parser.isEnded) parser.end();
  } catch (error) {
    if (error instanceof AppError) throw error;
    await reader.cancel(error).catch(() => undefined);
    throw invalidJsonError();
  } finally {
    reader.releaseLock();
  }

  if (!rootSeen) throw invalidJsonError();
  return parsedRoot;
}
