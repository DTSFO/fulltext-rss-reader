import { describe, expect, it } from "vitest";

import {
  decodeAppearanceLeaseStatusCursor,
  encodeAppearanceLeaseStatusCursor,
  leaseStatusResourceOrderKey,
} from "@/features/appearance/server/lease-status-cursor";

const THEME_ID = "11111111-1111-4111-8111-111111111111";

describe("appearance lease status cursor", () => {
  it.each([
    { kind: "root" as const },
    { kind: "config" as const },
    { kind: "theme" as const, themeId: THEME_ID },
  ])("round-trips deterministic resource identity %#", (resource) => {
    expect(decodeAppearanceLeaseStatusCursor(encodeAppearanceLeaseStatusCursor(resource))).toEqual(resource);
  });

  it("orders root, config, and theme identities deterministically", () => {
    expect([
      { kind: "theme" as const, themeId: THEME_ID },
      { kind: "config" as const },
      { kind: "root" as const },
    ].sort((left, right) => leaseStatusResourceOrderKey(left).localeCompare(leaseStatusResourceOrderKey(right))))
      .toEqual([
        { kind: "root" },
        { kind: "config" },
        { kind: "theme", themeId: THEME_ID },
      ]);
  });

  it.each(["not-base64-json", "e30", Buffer.from(JSON.stringify({ version: 1, resource: { kind: "theme", themeId: "bad" } })).toString("base64url")])(
    "rejects malformed cursor %s",
    (cursor) => expect(decodeAppearanceLeaseStatusCursor(cursor)).toBeNull(),
  );
});
