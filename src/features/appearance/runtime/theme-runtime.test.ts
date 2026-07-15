import { describe, expect, it } from "vitest";

import {
  extractVariableDependencies,
  findCyclicTokens,
  hasUnresolvedRequiredExternalVariable,
  rgbaToCanonical,
  shouldEnforceRuntimeContrast,
} from "@/features/appearance/runtime/theme-runtime";
import { BUILTIN_THEMES, cloneThemeTokens } from "@/features/appearance/theme-contract";

describe("appearance runtime", () => {
  it("extracts unique var dependencies", () => {
    expect(extractVariableDependencies("color-mix(in srgb, var(--accent), var(--accent) 50%, var(--external))")).toEqual([
      "--accent",
      "--external",
    ]);
  });

  it("finds self and multi-token dependency cycles", () => {
    const tokens = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    tokens.background.expression = "var(--surface)";
    tokens.surface.expression = "var(--background)";
    tokens.muted.expression = "var(--muted)";
    expect(findCyclicTokens(tokens)).toEqual(new Set(["background", "surface", "muted"]));
  });

  it("ignores unreachable fallbacks of defined theme aliases but checks active-variable fallbacks", () => {
    const tokens = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    tokens.surface.expression = "var(--background, var(--surface))";
    expect(findCyclicTokens(tokens)).not.toContain("surface");

    tokens.surface.expression = "var(--theme-background-active, var(--surface))";
    expect(findCyclicTokens(tokens)).toContain("surface");
  });

  it("allows a missing external var with a fallback but rejects a required one", () => {
    const readMissing = () => "";
    expect(hasUnresolvedRequiredExternalVariable("var(--missing, red)", readMissing)).toBe(false);
    expect(hasUnresolvedRequiredExternalVariable("var(--missing, var(--other, blue))", readMissing)).toBe(false);
    expect(hasUnresolvedRequiredExternalVariable("var(--missing)", readMissing)).toBe(true);
    expect(hasUnresolvedRequiredExternalVariable("var(--external)", (name) => name === "--external" ? "green" : "")).toBe(false);
  });

  it("skips custom contrast enforcement while forced colors are active", () => {
    expect(shouldEnforceRuntimeContrast(false)).toBe(true);
    expect(shouldEnforceRuntimeContrast(true)).toBe(false);
  });

  it("canonicalizes browser pixel channels", () => {
    expect(rgbaToCanonical(255, 0, 128, 127)).toBe("#ff00807f");
  });
});
