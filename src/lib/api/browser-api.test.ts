import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AUTHENTICATION_REQUIRED_EVENT } from "@/lib/auth/auth-events";

import { browserApiRequest, browserFileRequest, browserJsonFileRequest } from "./browser-api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browserApiRequest", () => {
  it("returns runtime-validated response data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { value: 42 } }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(browserApiRequest("/api/value", z.object({ value: z.number() }))).resolves.toEqual({ value: 42 });
  });

  it("uses the safe API error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "输入无效。" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(browserApiRequest("/api/value", z.object({ value: z.number() }))).rejects.toThrow("输入无效。");
  });

  it("rejects a successful response that violates its schema", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { value: "not-a-number" } }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(browserApiRequest("/api/value", z.object({ value: z.number() }))).rejects.toThrow("服务器返回的数据不完整。");
  });

  it("preserves compact streamed export bytes as a Blob", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"kind":"portable","version":1}', {
        headers: { "content-type": "application/json" },
      }),
    );

    const blob = await browserFileRequest("/api/export");
    await expect(blob.text()).resolves.toBe('{"kind":"portable","version":1}');
  });

  it("validates raw JSON exports", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ kind: "portable", version: 1 }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const schema = z.strictObject({ kind: z.literal("portable"), version: z.literal(1) });

    await expect(browserJsonFileRequest("/api/export", schema)).resolves.toEqual({ kind: "portable", version: 1 });
  });

  it("rejects malformed exports and forwards authentication cleanup", async () => {
    const listener = vi.fn();
    window.addEventListener(AUTHENTICATION_REQUIRED_EVENT, listener);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "wrong" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "AUTHENTICATION_REQUIRED", message: "请先登录。" },
      }), { status: 401 }));
    const schema = z.strictObject({ kind: z.literal("portable") });

    await expect(browserJsonFileRequest("/api/export", schema)).rejects.toThrow("服务器返回的导出文件不完整。");
    await expect(browserJsonFileRequest("/api/export", schema)).rejects.toThrow("请先登录。");
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(AUTHENTICATION_REQUIRED_EVENT, listener);
  });
});
