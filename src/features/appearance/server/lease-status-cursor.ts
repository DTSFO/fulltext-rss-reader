import { Buffer } from "node:buffer";

import type { LeaseResource } from "@/features/appearance/schemas/appearance-schema";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function leaseStatusResourceOrderKey(resource: LeaseResource): string {
  if (resource.kind === "root") return "0:root";
  if (resource.kind === "config") return "1:config";
  return `2:${resource.themeId}`;
}

export function encodeAppearanceLeaseStatusCursor(resource: LeaseResource): string {
  return Buffer.from(JSON.stringify({ version: 1, resource }), "utf8").toString("base64url");
}

export function decodeAppearanceLeaseStatusCursor(value: string | null | undefined): LeaseResource | null {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Object.keys(decoded).length !== 2) return null;
    if (!("version" in decoded) || decoded.version !== 1 || !("resource" in decoded)) return null;
    const resource = decoded.resource;
    if (!resource || typeof resource !== "object" || !("kind" in resource) || typeof resource.kind !== "string") {
      return null;
    }
    if (resource.kind === "root" || resource.kind === "config") {
      return Object.keys(resource).length === 1 ? { kind: resource.kind } : null;
    }
    if (
      resource.kind === "theme" &&
      Object.keys(resource).length === 2 &&
      "themeId" in resource &&
      typeof resource.themeId === "string" &&
      UUID_PATTERN.test(resource.themeId)
    ) {
      return { kind: "theme", themeId: resource.themeId };
    }
    return null;
  } catch {
    return null;
  }
}
