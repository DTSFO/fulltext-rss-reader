import type { z } from "zod";

import {
  configMutationDataSchema,
  type ConfigMutationInput,
  type AppearanceSnapshot,
} from "@/features/appearance/schemas/appearance-schema";
import { BrowserApiError, browserApiRequest } from "@/lib/api/browser-api";

function isUnknownMutationOutcome(error: unknown): boolean {
  if (!(error instanceof BrowserApiError)) return true;
  return error.status >= 500 || (error.status >= 200 && error.status < 300);
}

/** Retries the exact serialized appearance mutation once after an unknown outcome. */
export async function appearanceMutationRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  init: RequestInit,
): Promise<T> {
  try {
    return await browserApiRequest(url, schema, init);
  } catch (error) {
    if (!isUnknownMutationOutcome(error)) throw error;
    return browserApiRequest(url, schema, init);
  }
}

export async function mutateConfig(
  input: ConfigMutationInput,
): Promise<AppearanceSnapshot> {
  const data = await appearanceMutationRequest("/api/appearance", configMutationDataSchema, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.snapshot;
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(fileName: string, value: unknown): void {
  downloadBlob(fileName, new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
}
