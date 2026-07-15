import "server-only";

import {
  appearanceConfigSchema,
  browserValidationReportV1Schema,
  looseThemeSnapshotV1Schema,
  recoveryShortcutSchema,
  storedDraftSchema,
  storedThemeSchema,
  themeTokenMapSchema,
  type AppearanceConfig,
  type StoredTheme,
} from "@/features/appearance/schemas/appearance-schema";
import {
  BUILTIN_THEMES,
  type AppliedTheme,
  type DeclaredScheme,
  type ThemeSelector,
} from "@/features/appearance/theme-contract";

export type ThemeRow = {
  id: string;
  name: string;
  declaredScheme: string;
  contractVersion: number;
  tokens: unknown;
  validationCanvasColor: string;
  browserValidation: unknown;
  themeRevision: bigint;
  createdAt: Date;
  updatedAt: Date;
};

export type ConfigRow = {
  mode: string;
  lightThemeId: string | null;
  darkThemeId: string | null;
  recoveryShortcut: unknown;
  escapeRecoveryEnabled: boolean;
};

export function decodeStoredTheme(row: ThemeRow): StoredTheme {
  return storedThemeSchema.parse({
    id: row.id,
    name: row.name,
    declaredScheme: row.declaredScheme,
    tokenContractVersion: row.contractVersion,
    tokens: themeTokenMapSchema.parse(row.tokens),
    validationCanvas: { color: row.validationCanvasColor, source: "browser-canvas" },
    browserValidation:
      row.browserValidation === null ? null : browserValidationReportV1Schema.parse(row.browserValidation),
    themeRevision: row.themeRevision.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function decodeAppliedTheme(row: ThemeRow | undefined, scheme: DeclaredScheme): AppliedTheme {
  if (!row) return BUILTIN_THEMES[scheme];
  const stored = decodeStoredTheme(row);
  return {
    id: stored.id,
    selector: { kind: "custom", themeId: stored.id },
    name: stored.name,
    declaredScheme: stored.declaredScheme,
    tokenContractVersion: stored.tokenContractVersion,
    tokens: stored.tokens,
    validationCanvas: stored.validationCanvas,
  };
}

export function decodeAppearanceConfig(row: ConfigRow): AppearanceConfig {
  const shortcut = row.recoveryShortcut === null ? null : recoveryShortcutSchema.parse(row.recoveryShortcut);
  return appearanceConfigSchema.parse({
    mode: row.mode,
    lightTheme: selectorFromId(row.lightThemeId),
    darkTheme: selectorFromId(row.darkThemeId),
    recoveryShortcut: shortcut,
    escapeRecoveryEnabled: row.escapeRecoveryEnabled,
  });
}

export function selectorFromId(themeId: string | null): ThemeSelector {
  return themeId ? { kind: "custom", themeId } : { kind: "builtin" };
}

export function selectorToId(selector: ThemeSelector): string | null {
  return selector.kind === "custom" ? selector.themeId : null;
}

export function decodeStoredDraft(row: {
  contractVersion: number;
  payload: unknown;
  baseThemeRevision: bigint;
  draftRevision: bigint;
  updatedAt: Date;
}) {
  return storedDraftSchema.parse({
    contractVersion: row.contractVersion,
    payload: looseThemeSnapshotV1Schema.parse(row.payload),
    baseThemeRevision: row.baseThemeRevision.toString(),
    draftRevision: row.draftRevision.toString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
