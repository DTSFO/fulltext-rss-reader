import { beforeAll, describe, expect, it, vi } from "vitest";

import { BUILTIN_THEMES } from "@/features/appearance/theme-contract";

vi.mock("server-only", () => ({}));

type LimitsModule = typeof import("@/features/appearance/server/technical-limits");
type PortableSizeModule = typeof import("@/features/appearance/server/portable-size");
let limits: LimitsModule["APPEARANCE_TECHNICAL_LIMITS"];
let browserValidationImportExpansionBytes: PortableSizeModule["browserValidationImportExpansionBytes"];
let projectedPackageImportRequestBytes: PortableSizeModule["projectedPackageImportRequestBytes"];
let projectedThemeImportRequestBytes: PortableSizeModule["projectedThemeImportRequestBytes"];

beforeAll(async () => {
  ({ APPEARANCE_TECHNICAL_LIMITS: limits } = await import("@/features/appearance/server/technical-limits"));
  ({
    browserValidationImportExpansionBytes,
    projectedPackageImportRequestBytes,
    projectedThemeImportRequestBytes,
  } = await import("@/features/appearance/server/portable-size"));
});

const portableTheme = {
  name: "Portable",
  declaredScheme: "light" as const,
  tokenContractVersion: 1 as const,
  tokens: BUILTIN_THEMES.light.tokens,
  validationCanvas: BUILTIN_THEMES.light.validationCanvas,
  browserValidation: null,
};

describe("appearance technical limits", () => {
  it("projects the complete regenerated browser report instead of a fixed envelope reserve", () => {
    const reportExpansion = browserValidationImportExpansionBytes(portableTheme);
    expect(reportExpansion).toBeGreaterThan(4 * 1024);
    expect(projectedThemeImportRequestBytes({
      kind: "fulltext-rss-reader.theme",
      version: 1,
      theme: portableTheme,
    })).toBeLessThan(limits.themeRequestBytes);

    expect(projectedPackageImportRequestBytes(25 * 1024 * 1024, reportExpansion * 10_000))
      .toBeGreaterThan(limits.packageRequestBytes);
  });

  it("keeps the frozen limits ordered and deployment-bounded", () => {
    expect(limits.listDefault).toBeLessThanOrEqual(limits.listMaximum);
    expect(limits.leaseHeartbeatMs).toBeLessThan(limits.leaseSeconds * 1_000);
    expect(limits.restoreInsertBatch).toBeGreaterThan(0);
    expect(limits.snapshotTimeoutMs).toBeGreaterThan(limits.statementTimeoutMs);
  });
});
