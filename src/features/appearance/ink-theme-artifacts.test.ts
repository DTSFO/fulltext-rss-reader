import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateThemeContrast } from "@/features/appearance/color-math";
import { themeFileV1Schema } from "@/features/appearance/schemas/appearance-schema";
import { THEME_TOKEN_NAMES } from "@/features/appearance/theme-contract";

const artifacts = [
  {
    path: "themes/fulltext-rss-reader-ink-paper.json",
    name: "宣纸墨染",
    scheme: "light",
    canvas: "#f5f0e6",
  },
  {
    path: "themes/fulltext-rss-reader-ink-night.json",
    name: "夜墨",
    scheme: "dark",
    canvas: "#080a09",
  },
] as const;

describe("ink theme artifacts", () => {
  for (const artifact of artifacts) {
    it(`keeps ${artifact.name} portable, complete, and contrast-safe`, () => {
      const raw = readFileSync(`${process.cwd()}/${artifact.path}`, "utf8");
      const file = themeFileV1Schema.parse(JSON.parse(raw));

      expect(file.kind).toBe("fulltext-rss-reader.theme");
      expect(file.version).toBe(1);
      expect(file.theme.name).toBe(artifact.name);
      expect(file.theme.declaredScheme).toBe(artifact.scheme);
      expect(file.theme.validationCanvas.color).toBe(artifact.canvas);
      expect(file.theme.browserValidation).toBeNull();
      expect(Object.keys(file.theme.tokens).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
      expect(Object.values(file.theme.tokens).every((value) => value.expression === value.fallback)).toBe(true);
      expect(validateThemeContrast(file.theme.tokens, file.theme.validationCanvas.color)).toEqual([]);

      expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
      expect(raw).not.toMatch(/account(?:id)?|user(?:name|id)?|themeId|portableId|draft|lease|revision|receipt|holderToken/i);
      expect(raw).not.toMatch(/\/(?:home|opt|srv|var|api)\//i);
    });
  }
});
