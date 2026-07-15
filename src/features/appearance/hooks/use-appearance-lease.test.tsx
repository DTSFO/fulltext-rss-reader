import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeaseHandle } from "@/features/appearance/schemas/appearance-schema";
import { useAppearanceLease } from "@/features/appearance/hooks/use-appearance-lease";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/browser-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browser-api")>("@/lib/api/browser-api");
  return { ...actual, browserApiRequest: requestMock };
});

const handle: LeaseHandle = {
  resource: { kind: "theme", themeId: "44444444-4444-4444-8444-444444444444" },
  leaseId: "55555555-5555-4555-8555-555555555555",
  lockEpoch: "0",
  fence: "1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  serverNow: "2026-07-14T00:00:00.000Z",
  requiresDraftResolution: false,
};

const successorHandle: LeaseHandle = {
  ...handle,
  leaseId: "66666666-6666-4666-8666-666666666666",
  fence: "2",
};

describe("useAppearanceLease", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((url: string) => {
      if (url.endsWith("/acquire")) return Promise.resolve({ handles: [handle] });
      if (url.endsWith("/release")) return Promise.resolve({ released: true });
      throw new Error(`Unexpected appearance lease request: ${url}`);
    });
  });

  it("clears a lease released immediately from the acquire result", async () => {
    const { result } = renderHook(() => useAppearanceLease("a".repeat(64)));

    await act(async () => {
      const acquired = await result.current.acquire([handle.resource]);
      await result.current.release(acquired);
    });

    expect(requestMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/appearance/leases/acquire",
      "/api/appearance/leases/release",
    ]);
    expect(result.current.handles).toEqual([]);
    expect(result.current.status).toBe("idle");
  });

  it("releases and reacquires a lease across BFCache restoration", async () => {
    const { result } = renderHook(() => useAppearanceLease("a".repeat(64)));
    await act(async () => {
      await result.current.acquire([handle.resource]);
    });

    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: true });
    act(() => {
      window.dispatchEvent(pagehide);
    });
    expect(result.current.handles).toEqual([]);

    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    act(() => {
      window.dispatchEvent(pageshow);
    });
    await vi.waitFor(() => {
      expect(result.current.status).toBe("active");
      expect(result.current.handles).toEqual([handle]);
    });

    expect(requestMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/appearance/leases/acquire",
      "/api/appearance/leases/release",
      "/api/appearance/leases/acquire",
    ]);
  });

  it("ignores a renewal response from before BFCache reacquisition", async () => {
    vi.useFakeTimers();
    let acquireCount = 0;
    let resolveRenewal: ((value: { handles: LeaseHandle[] }) => void) | undefined;
    requestMock.mockImplementation((url: string) => {
      if (url.endsWith("/acquire")) {
        acquireCount += 1;
        return Promise.resolve({ handles: [acquireCount === 1 ? handle : successorHandle] });
      }
      if (url.endsWith("/renew")) {
        return new Promise<{ handles: LeaseHandle[] }>((resolve) => {
          resolveRenewal = resolve;
        });
      }
      if (url.endsWith("/release")) return Promise.resolve({ released: true });
      throw new Error(`Unexpected appearance lease request: ${url}`);
    });

    try {
      const { result } = renderHook(() => useAppearanceLease("a".repeat(64)));
      await act(async () => {
        await result.current.acquire([handle.resource]);
      });
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      const pagehide = new Event("pagehide");
      Object.defineProperty(pagehide, "persisted", { value: true });
      const pageshow = new Event("pageshow");
      Object.defineProperty(pageshow, "persisted", { value: true });
      await act(async () => {
        window.dispatchEvent(pagehide);
        window.dispatchEvent(pageshow);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.handles).toEqual([successorHandle]);

      await act(async () => {
        resolveRenewal?.({ handles: [handle] });
        await Promise.resolve();
      });
      expect(result.current.handles).toEqual([successorHandle]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases an acquisition that completes after the editor unmounts", async () => {
    let resolveAcquire: ((value: { handles: LeaseHandle[] }) => void) | undefined;
    requestMock.mockImplementation((url: string) => {
      if (url.endsWith("/acquire")) {
        return new Promise<{ handles: LeaseHandle[] }>((resolve) => {
          resolveAcquire = resolve;
        });
      }
      if (url.endsWith("/release")) return Promise.resolve({ released: true });
      throw new Error(`Unexpected appearance lease request: ${url}`);
    });
    const { result, unmount } = renderHook(() => useAppearanceLease("a".repeat(64)));
    let acquiring: Promise<LeaseHandle[]> | undefined;
    act(() => {
      acquiring = result.current.acquire([handle.resource]);
    });
    unmount();

    await act(async () => {
      resolveAcquire?.({ handles: [handle] });
      await acquiring;
    });

    expect(requestMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/appearance/leases/acquire",
      "/api/appearance/leases/release",
    ]);
  });
});
