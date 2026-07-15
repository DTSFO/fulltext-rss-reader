import { describe, expect, it } from "vitest";

import {
  compositeThemeBackground,
  contrastRatio,
  parseCanonicalRgba,
  relativeLuminance,
  sourceOver,
  validateThemeContrast,
} from "@/features/appearance/color-math";
import { BUILTIN_THEMES, cloneThemeTokens } from "@/features/appearance/theme-contract";

describe("appearance color math", () => {
  it("parses canonical RGBA and rejects non-canonical values", () => {
    expect(parseCanonicalRgba("#ff000080")).toEqual({ r: 1, g: 0, b: 0, a: 128 / 255 });
    expect(parseCanonicalRgba("#FF000080")).toBeNull();
    expect(parseCanonicalRgba("red")).toBeNull();
  });

  it("composites translucent colors source-over an opaque canvas", () => {
    const result = sourceOver(
      { r: 1, g: 0, b: 0, a: 0.5 },
      { r: 0, g: 0, b: 1, a: 1 },
    );
    expect(result).toEqual({ r: 0.5, g: 0, b: 0.5, a: 1 });
  });

  it("computes WCAG luminance and contrast boundary values", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 1, g: 1, b: 1, a: 1 };
    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBe(1);
    expect(contrastRatio(black, white)).toBe(21);
  });

  it("terminates a transparent root background at the saved browser canvas", () => {
    const tokens = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    tokens.background = { expression: "transparent", fallback: "#00000000" };
    expect(compositeThemeBackground(tokens, "#abcdef")).toBe("#abcdef");
  });

  it("reports explicit pair diagnostics when contrast is insufficient", () => {
    const tokens = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    tokens.foreground = { expression: "#ffffff", fallback: "#ffffffff" };
    tokens.muted = { expression: "#ffffff", fallback: "#ffffffff" };
    tokens.subtle = { expression: "#ffffff", fallback: "#ffffffff" };
    const diagnostics = validateThemeContrast(tokens, "#ffffff");
    expect(diagnostics.some((item) => item.path === "tokens.foreground" && item.minimum === 4.5)).toBe(true);
    expect(diagnostics.every((item) => item.ratio < item.minimum)).toBe(true);
  });
});
