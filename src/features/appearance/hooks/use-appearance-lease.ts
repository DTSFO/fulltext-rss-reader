"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  leaseSetDataSchema,
  releaseLeaseDataSchema,
  type LeaseHandle,
  type LeaseResource,
} from "@/features/appearance/schemas/appearance-schema";
import { APPEARANCE_CLIENT_TIMING } from "@/features/appearance/theme-contract";
import { browserApiRequest, BrowserApiError } from "@/lib/api/browser-api";

export type LeaseStatus = "idle" | "acquiring" | "active" | "conflict" | "lost" | "error";

function createHolderToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function resourceIdentity(handle: LeaseHandle): string {
  return handle.resource.kind === "theme"
    ? `theme:${handle.resource.themeId}`
    : handle.resource.kind;
}

function sameLeaseSet(first: LeaseHandle[], second: LeaseHandle[]): boolean {
  return first.length === second.length && first.every((handle) => second.some((candidate) =>
    resourceIdentity(candidate) === resourceIdentity(handle) &&
    candidate.leaseId === handle.leaseId &&
    candidate.lockEpoch === handle.lockEpoch &&
    candidate.fence === handle.fence,
  ));
}

export function useAppearanceLease(initialHolderToken?: string) {
  const [holderToken] = useState(() => initialHolderToken ?? createHolderToken());
  const [handles, setHandles] = useState<LeaseHandle[]>([]);
  const [status, setStatus] = useState<LeaseStatus>("idle");
  const [error, setError] = useState<BrowserApiError | null>(null);
  const errorRef = useRef<BrowserApiError | null>(null);
  const handlesRef = useRef<LeaseHandle[]>([]);
  const leaseGenerationRef = useRef(0);
  const renewalRequestRef = useRef(0);
  const requestedResourcesRef = useRef<LeaseResource[]>([]);
  const pageHideReleaseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    handlesRef.current = handles;
  }, [handles]);

  const releaseRemote = useCallback(async (releasing: LeaseHandle[]) => {
    if (releasing.length === 0) return;
    try {
      await browserApiRequest("/api/appearance/leases/release", releaseLeaseDataSchema, {
        method: "POST",
        body: JSON.stringify({ holderToken, handles: releasing }),
        keepalive: true,
      });
    } catch {
      // Expiry and exact fence checks remain authoritative; release is best effort.
    }
  }, [holderToken]);

  const release = useCallback(async (specificHandles?: LeaseHandle[]) => {
    const releasing = specificHandles ?? handlesRef.current;
    const releasingCurrent = !specificHandles || sameLeaseSet(specificHandles, handlesRef.current);
    if (releasing.length === 0) {
      if (releasingCurrent) {
        handlesRef.current = [];
        requestedResourcesRef.current = [];
        leaseGenerationRef.current += 1;
        if (mountedRef.current) {
          setHandles([]);
          setStatus("idle");
        }
      }
      return;
    }
    await releaseRemote(releasing);
    if (releasingCurrent) {
      handlesRef.current = [];
      requestedResourcesRef.current = [];
      leaseGenerationRef.current += 1;
      if (mountedRef.current) {
        setHandles([]);
        setStatus("idle");
      }
    }
  }, [releaseRemote]);

  const acquire = useCallback(async (resources: LeaseResource[]) => {
    const previous = handlesRef.current;
    if (previous.length > 0) await release(previous);
    if (!mountedRef.current) return [];
    requestedResourcesRef.current = resources.map((resource) => ({ ...resource }));
    const requestGeneration = ++leaseGenerationRef.current;
    setStatus("acquiring");
    errorRef.current = null;
    setError(null);
    try {
      const data = await browserApiRequest("/api/appearance/leases/acquire", leaseSetDataSchema, {
        method: "POST",
        body: JSON.stringify({ holderToken, resources }),
      });
      if (!mountedRef.current) {
        void releaseRemote(data.handles);
        return [];
      }
      if (requestGeneration !== leaseGenerationRef.current) return [];
      handlesRef.current = data.handles;
      setHandles(data.handles);
      setStatus("active");
      return data.handles;
    } catch (caught) {
      if (!mountedRef.current) return [];
      const apiError = caught instanceof BrowserApiError ? caught : null;
      if (requestGeneration !== leaseGenerationRef.current) return [];
      errorRef.current = apiError;
      setError(apiError);
      setStatus(apiError?.code === "APPEARANCE_LEASE_CONFLICT" ? "conflict" : "error");
      return [];
    }
  }, [holderToken, release, releaseRemote]);

  useEffect(() => {
    if (handles.length === 0) return;
    const interval = window.setInterval(() => {
      const current = handlesRef.current;
      if (current.length === 0) return;
      const renewalGeneration = leaseGenerationRef.current;
      const renewalRequest = ++renewalRequestRef.current;
      void browserApiRequest("/api/appearance/leases/renew", leaseSetDataSchema, {
        method: "POST",
        body: JSON.stringify({
          holderToken,
          handles: current,
        }),
      }).then(
        (data) => {
          if (!mountedRef.current) {
            void releaseRemote(data.handles);
            return;
          }
          if (
            renewalGeneration !== leaseGenerationRef.current ||
            renewalRequest !== renewalRequestRef.current
          ) return;
          handlesRef.current = data.handles;
          setHandles(data.handles);
          setStatus("active");
        },
        (caught: unknown) => {
          if (
            !mountedRef.current ||
            renewalGeneration !== leaseGenerationRef.current ||
            renewalRequest !== renewalRequestRef.current
          ) return;
          const apiError = caught instanceof BrowserApiError ? caught : null;
          errorRef.current = apiError;
          setError(apiError);
          setStatus(
            apiError?.code === "APPEARANCE_LEASE_CONFLICT"
              ? "conflict"
              : apiError && ["APPEARANCE_LEASE_EXPIRED", "APPEARANCE_LEASE_LOST"].includes(apiError.code)
                ? "lost"
                : "error",
          );
          leaseGenerationRef.current += 1;
          handlesRef.current = [];
          setHandles([]);
        },
      );
    }, APPEARANCE_CLIENT_TIMING.leaseHeartbeatMs);
    return () => window.clearInterval(interval);
  }, [handles.length, holderToken, releaseRemote]);

  useEffect(() => {
    function releaseOnPageHide(event: PageTransitionEvent) {
      const current = handlesRef.current;
      if (current.length === 0) return;
      const releasing = releaseRemote(current);
      if (!event.persisted) return;
      pageHideReleaseRef.current = releasing;
      leaseGenerationRef.current += 1;
      handlesRef.current = [];
      setHandles([]);
      setStatus("idle");
    }

    function reacquireOnPageShow(event: PageTransitionEvent) {
      if (!event.persisted || requestedResourcesRef.current.length === 0) return;
      const resources = requestedResourcesRef.current.map((resource) => ({ ...resource }));
      void (async () => {
        await pageHideReleaseRef.current;
        pageHideReleaseRef.current = null;
        if (mountedRef.current) await acquire(resources);
      })();
    }

    window.addEventListener("pagehide", releaseOnPageHide);
    window.addEventListener("pageshow", reacquireOnPageShow);
    return () => {
      window.removeEventListener("pagehide", releaseOnPageHide);
      window.removeEventListener("pageshow", reacquireOnPageShow);
      void release();
    };
  }, [acquire, release, releaseRemote]);

  const adopt = useCallback((nextHandles: LeaseHandle[]) => {
    if (!mountedRef.current) {
      void releaseRemote(nextHandles);
      return;
    }
    leaseGenerationRef.current += 1;
    handlesRef.current = nextHandles;
    requestedResourcesRef.current = nextHandles.map((handle) => ({ ...handle.resource }));
    setHandles(nextHandles);
    setStatus(nextHandles.length > 0 ? "active" : "idle");
    errorRef.current = null;
    setError(null);
  }, [releaseRemote]);

  const currentError = useCallback(() => errorRef.current, []);

  return { holderToken, handles, status, error, currentError, acquire, release, adopt };
}
