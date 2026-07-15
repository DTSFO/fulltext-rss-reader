import { z } from "zod";

import { AUTHENTICATION_REQUIRED_EVENT } from "@/lib/auth/auth-events";

const apiEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      requestId: z.string().optional(),
      details: z.unknown().optional(),
    })
    .optional(),
});

export class BrowserApiError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly status: number;

  constructor(options: { message: string; code?: string; details?: unknown; requestId?: string; status: number }) {
    super(options.message);
    this.name = "BrowserApiError";
    this.code = options.code ?? "REQUEST_FAILED";
    this.details = options.details;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

function apiErrorFromPayload(response: Response, payload: unknown): BrowserApiError {
  const envelope = apiEnvelopeSchema.safeParse(payload);
  const error = envelope.success ? envelope.data.error : undefined;
  if (error?.code === "AUTHENTICATION_REQUIRED" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTHENTICATION_REQUIRED_EVENT));
  }
  return new BrowserApiError({
    message: error?.message ?? "请求失败，请稍后重试。",
    code: error?.code,
    details: error?.details,
    requestId: error?.requestId,
    status: response.status,
  });
}

export async function browserApiRequest<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BrowserApiError({ message: "服务器返回了无法识别的数据。", status: response.status });
  }

  const envelope = apiEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new BrowserApiError({ message: "服务器返回了无法识别的数据。", status: response.status });
  }

  if (!response.ok || envelope.data.data === undefined) {
    throw apiErrorFromPayload(response, payload);
  }

  const parsedData = schema.safeParse(envelope.data.data);
  if (!parsedData.success) {
    throw new BrowserApiError({ message: "服务器返回的数据不完整。", status: response.status });
  }

  return parsedData.data;
}

/** Parses a raw, portable JSON document while preserving the API error contract. */
export async function browserFileRequest(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BrowserApiError({ message: "服务器返回了无法识别的数据。", status: response.status });
    }
    throw apiErrorFromPayload(response, payload);
  }
  return response.blob();
}

export async function browserJsonFileRequest<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BrowserApiError({ message: "服务器返回了无法识别的数据。", status: response.status });
  }
  if (!response.ok) throw apiErrorFromPayload(response, payload);

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new BrowserApiError({ message: "服务器返回的导出文件不完整。", status: response.status });
  }
  return parsed.data;
}
