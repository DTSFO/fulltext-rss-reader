import { describe, expect, it } from "vitest";

import { buildAppearanceFallbackCss } from "@/features/appearance/appearance-css";
import { DEFAULT_APPEARANCE_SNAPSHOT, THEME_TOKEN_NAMES } from "@/features/appearance/theme-contract";

describe("appearance SSR CSS", () => {
  it("serializes only canonical fallback values under fixed property names", () => {
    const css = buildAppearanceFallbackCss(DEFAULT_APPEARANCE_SNAPSHOT);
    expect(css).toContain("@media (prefers-color-scheme:dark)");
    for (const name of THEME_TOKEN_NAMES) {
      expect(css).toContain(DEFAULT_APPEARANCE_SNAPSHOT.lightTheme.tokens[name].fallback);
      expect(css).toContain(DEFAULT_APPEARANCE_SNAPSHOT.darkTheme.tokens[name].fallback);
    }
    expect(css).not.toContain("browserValidation");
    expect(css).not.toContain("expression");
  });

  it("never emits dynamic expressions into SSR style text", () => {
    const snapshot = structuredClone(DEFAULT_APPEARANCE_SNAPSHOT);
    snapshot.lightTheme.tokens.background.expression = "red;--escaped:lime";
    expect(buildAppearanceFallbackCss(snapshot)).not.toContain("escaped");
  });
});
