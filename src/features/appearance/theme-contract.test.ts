import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateThemeContrast } from "@/features/appearance/color-math";
import {
  appearancePackageV1Schema,
  formalThemePayloadV1Schema,
  mutationReceiptSafeResultSchema,
  recoveryShortcutSchema,
  themeFileV1Schema,
  themeTokenMapSchema,
} from "@/features/appearance/schemas/appearance-schema";
import {
  BUILTIN_THEMES,
  CONTRAST_PAIRS_V1,
  DEFAULT_APPEARANCE_SNAPSHOT,
  SEMANTIC_COLOR_USES_V1,
  THEME_TOKEN_NAMES,
  THEME_TOKEN_REGISTRY,
} from "@/features/appearance/theme-contract";

describe("appearance theme contract", () => {
  it("keeps a complete, unique fixed token registry with valid built-ins", () => {
    expect(new Set(THEME_TOKEN_NAMES).size).toBe(THEME_TOKEN_NAMES.length);
    expect(Object.keys(THEME_TOKEN_REGISTRY).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
    expect(themeTokenMapSchema.parse(BUILTIN_THEMES.light.tokens)).toEqual(BUILTIN_THEMES.light.tokens);
    expect(themeTokenMapSchema.parse(BUILTIN_THEMES.dark.tokens)).toEqual(BUILTIN_THEMES.dark.tokens);
    expect(formalThemePayloadV1Schema.parse({
      tokenContractVersion: 1,
      tokens: BUILTIN_THEMES.light.tokens,
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
    })).toBeDefined();
  });

  it("gates both built-in fallback palettes with the central contrast contract", () => {
    expect(CONTRAST_PAIRS_V1.length).toBeGreaterThan(30);
    expect(validateThemeContrast(BUILTIN_THEMES.light.tokens, BUILTIN_THEMES.light.validationCanvas.color)).toEqual([]);
    expect(validateThemeContrast(BUILTIN_THEMES.dark.tokens, BUILTIN_THEMES.dark.validationCanvas.color)).toEqual([]);
  });

  it("maps every audited visible semantic use to at least one mandatory pair", () => {
    const coveredUses = new Set(CONTRAST_PAIRS_V1.flatMap((pair) => pair.uses));
    expect([...coveredUses].sort()).toEqual([...SEMANTIC_COLOR_USES_V1].sort());
    expect(CONTRAST_PAIRS_V1.every((pair) => pair.minimum === 4.5 || pair.minimum === 3)).toBe(true);
    expect(CONTRAST_PAIRS_V1.filter((pair) => pair.kind === "normal-text").every((pair) => pair.minimum === 4.5)).toBe(true);
    expect(CONTRAST_PAIRS_V1.filter((pair) => pair.kind === "non-text").every((pair) => pair.minimum === 3)).toBe(true);
  });

  it("rejects missing, unknown, and non-canonical token values", () => {
    const missing = { ...BUILTIN_THEMES.light.tokens } as Record<string, unknown>;
    delete missing.background;
    expect(themeTokenMapSchema.safeParse(missing).success).toBe(false);
    expect(themeTokenMapSchema.safeParse({ ...BUILTIN_THEMES.light.tokens, evil: { expression: "red", fallback: "#ff0000ff" } }).success).toBe(false);
    expect(themeTokenMapSchema.safeParse({
      ...BUILTIN_THEMES.light.tokens,
      background: { expression: "red", fallback: "#FFFFFF" },
    }).success).toBe(false);
  });

  it("keeps shadow geometry fixed and exposes only its color inputs", () => {
    expect(THEME_TOKEN_NAMES.filter((name) => name.toLowerCase().includes("shadow")))
      .toEqual(["shadowColor", "shadowStrongColor"]);
    const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
    expect(css).toContain("--shadow: 0 18px 50px var(--shadow-color)");
    expect(css).toContain("--shadow-strong: 0 22px 60px var(--shadow-strong-color)");
    expect(css).toContain("--shadow-control: 0 1px 2px var(--shadow-color)");
  });

  it("uses separate portable discriminators and excludes account state", () => {
    const themeFile = themeFileV1Schema.parse({
      kind: "fulltext-rss-reader.theme",
      version: 1,
      theme: {
        name: "Paper",
        declaredScheme: "light",
        tokenContractVersion: 1,
        tokens: BUILTIN_THEMES.light.tokens,
        validationCanvas: BUILTIN_THEMES.light.validationCanvas,
        browserValidation: null,
      },
    });
    expect(themeFile.kind).toBe("fulltext-rss-reader.theme");
    expect(appearancePackageV1Schema.safeParse(themeFile).success).toBe(false);
    expect(JSON.stringify(themeFile)).not.toMatch(/account|username|draft|lease|receipt/i);
  });

  it("validates discriminated mutation receipt results and rejects unsafe arbitrary JSON", () => {
    expect(mutationReceiptSafeResultSchema.parse({
      kind: "draft-saved",
      themeId: "44444444-4444-4444-8444-444444444444",
      draftRevision: "2",
      diagnostics: [{ path: "tokens.background", code: "CONTRAST_TOO_LOW", message: "too low" }],
      stateRevision: "3",
      publishedRevision: "1",
    })).toBeDefined();
    expect(mutationReceiptSafeResultSchema.safeParse({
      kind: "draft-saved",
      themeId: "44444444-4444-4444-8444-444444444444",
      draftRevision: "2",
      diagnostics: [],
      stateRevision: "3",
      publishedRevision: "1",
      holderToken: "secret",
    }).success).toBe(false);
    expect(mutationReceiptSafeResultSchema.safeParse({
      kind: "made-up-result",
      stateRevision: "3",
      publishedRevision: "1",
    }).success).toBe(false);
  });

  it("validates recovery shortcuts and rejects unsafe combinations", () => {
    expect(recoveryShortcutSchema.safeParse({
      code: "KeyY",
      ctrl: false,
      alt: true,
      meta: false,
      shift: true,
      conflictTableVersion: 1,
    }).success).toBe(true);
    expect(recoveryShortcutSchema.safeParse({
      code: "KeyY",
      ctrl: false,
      alt: false,
      meta: false,
      shift: true,
      conflictTableVersion: 1,
    }).success).toBe(false);
    expect(recoveryShortcutSchema.safeParse({
      code: "KeyW",
      ctrl: true,
      alt: false,
      meta: false,
      shift: false,
      conflictTableVersion: 1,
    }).success).toBe(false);
    expect(recoveryShortcutSchema.safeParse({
      code: "KeyS",
      ctrl: true,
      alt: false,
      meta: false,
      shift: false,
      conflictTableVersion: 1,
    }).success).toBe(false);
    expect(recoveryShortcutSchema.safeParse({
      code: "KeyA",
      ctrl: false,
      alt: false,
      meta: true,
      shift: false,
      conflictTableVersion: 1,
    }).success).toBe(false);
    expect(recoveryShortcutSchema.safeParse({
      code: "ArrowLeft",
      ctrl: false,
      alt: true,
      meta: false,
      shift: false,
      conflictTableVersion: 1,
    }).success).toBe(false);
    for (const shortcut of [
      { code: "Tab", ctrl: true, alt: false, meta: false, shift: false },
      { code: "Tab", ctrl: false, alt: true, meta: false, shift: false },
      { code: "Tab", ctrl: false, alt: false, meta: true, shift: true },
      { code: "PageUp", ctrl: true, alt: false, meta: false, shift: false },
      { code: "PageDown", ctrl: true, alt: false, meta: false, shift: false },
      { code: "Delete", ctrl: true, alt: true, meta: false, shift: false },
      { code: "KeyL", ctrl: true, alt: true, meta: false, shift: false },
      { code: "KeyT", ctrl: true, alt: true, meta: false, shift: false },
      { code: "Delete", ctrl: true, alt: false, meta: false, shift: true },
      { code: "Escape", ctrl: true, alt: false, meta: false, shift: false },
      { code: "Escape", ctrl: false, alt: true, meta: false, shift: false },
    ]) {
      expect(recoveryShortcutSchema.safeParse({
        ...shortcut,
        conflictTableVersion: 1,
      }).success).toBe(false);
    }

    const browserReservedCodes = [
      ...Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
      ...Array.from({ length: 10 }, (_, index) => `Digit${index}`),
      "Delete",
      "Escape",
      ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
    ];
    for (const code of browserReservedCodes) {
      for (const modifier of ["ctrl", "meta"] as const) {
        expect(recoveryShortcutSchema.safeParse({
          code,
          ctrl: modifier === "ctrl",
          alt: false,
          meta: modifier === "meta",
          shift: true,
          conflictTableVersion: 1,
        }).success).toBe(false);
      }
    }

    const navigationCodes = [
      "Tab",
      "PageUp",
      "PageDown",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "Delete",
      "Escape",
      "Space",
      "Enter",
    ];
    for (const code of navigationCodes) {
      for (const modifier of ["ctrl", "alt", "meta"] as const) {
        expect(recoveryShortcutSchema.safeParse({
          code,
          ctrl: modifier === "ctrl",
          alt: modifier === "alt",
          meta: modifier === "meta",
          shift: true,
          conflictTableVersion: 1,
        }).success).toBe(false);
      }
    }

    for (const code of Array.from({ length: 24 }, (_, index) => `F${index + 1}`)) {
      expect(recoveryShortcutSchema.safeParse({
        code,
        ctrl: false,
        alt: true,
        meta: false,
        shift: true,
        conflictTableVersion: 1,
      }).success).toBe(false);
    }

    for (const modifiers of [
      { ctrl: true, alt: true, meta: false },
      { ctrl: true, alt: false, meta: true },
      { ctrl: false, alt: true, meta: true },
      { ctrl: true, alt: true, meta: true },
    ]) {
      expect(recoveryShortcutSchema.safeParse({
        code: "F2",
        ...modifiers,
        shift: true,
        conflictTableVersion: 1,
      }).success).toBe(false);
    }
  });

  it("defines the built-in three-mode/two-slot baseline", () => {
    expect(DEFAULT_APPEARANCE_SNAPSHOT.config).toEqual({
      mode: "system",
      lightTheme: { kind: "builtin" },
      darkTheme: { kind: "builtin" },
      recoveryShortcut: null,
      escapeRecoveryEnabled: true,
    });
  });
});
