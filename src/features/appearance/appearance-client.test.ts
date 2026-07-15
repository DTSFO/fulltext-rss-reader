import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { appearanceMutationRequest } from "@/features/appearance/appearance-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("appearanceMutationRequest", () => {
  it("retries an unknown response-loss outcome with the identical operation id and body", async () => {
    const body = JSON.stringify({ operationId: "44444444-4444-4444-8444-444444444444", value: 1 });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { saved: true } }), {
        headers: { "content-type": "application/json" },
      }));

    await expect(appearanceMutationRequest(
      "/api/appearance/example",
      z.object({ saved: z.boolean() }),
      { method: "POST", body },
    )).resolves.toEqual({ saved: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([body, body]);
  });

  it("does not retry a deterministic operation conflict", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        error: { code: "APPEARANCE_OPERATION_CONFLICT", message: "操作标识已被使用。" },
      }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(appearanceMutationRequest(
      "/api/appearance/example",
      z.object({ saved: z.boolean() }),
      {
        method: "POST",
        body: JSON.stringify({ operationId: "44444444-4444-4444-8444-444444444444" }),
      },
    )).rejects.toMatchObject({ code: "APPEARANCE_OPERATION_CONFLICT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
