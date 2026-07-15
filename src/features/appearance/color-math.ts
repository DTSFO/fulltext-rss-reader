import {
  CONTRAST_PAIRS_V1,
  THEME_TOKEN_REGISTRY,
  type ThemeTokenMap,
  type ThemeTokenName,
} from "@/features/appearance/theme-contract";

export type RgbaColor = { r: number; g: number; b: number; a: number };

export type ContrastDiagnostic = {
  path: string;
  code: "CONTRAST_TOO_LOW";
  message: string;
  ratio: number;
  minimum: number;
};

export function parseCanonicalRgba(value: string): RgbaColor | null {
  if (!/^#[0-9a-f]{8}$/.test(value)) return null;
  return {
    r: Number.parseInt(value.slice(1, 3), 16) / 255,
    g: Number.parseInt(value.slice(3, 5), 16) / 255,
    b: Number.parseInt(value.slice(5, 7), 16) / 255,
    a: Number.parseInt(value.slice(7, 9), 16) / 255,
  };
}

export function parseOpaqueCanvas(value: string): RgbaColor | null {
  if (!/^#[0-9a-f]{6}$/.test(value)) return null;
  return parseCanonicalRgba(`${value}ff`);
}

export function toCanonicalRgba(color: RgbaColor): string {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}${channel(color.a)}`;
}

export function sourceOver(source: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = source.a + background.a * (1 - source.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (source.r * source.a + background.r * background.a * (1 - source.a)) / alpha,
    g: (source.g * source.a + background.g * background.a * (1 - source.a)) / alpha,
    b: (source.b * source.a + background.b * background.a * (1 - source.a)) / alpha,
    a: alpha,
  };
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: RgbaColor): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

export function contrastRatio(first: RgbaColor, second: RgbaColor): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function compositeTokenBackground(
  token: ThemeTokenName,
  tokens: ThemeTokenMap,
  canvas: RgbaColor,
  visited = new Set<ThemeTokenName>(),
): RgbaColor | null {
  if (visited.has(token)) return null;
  visited.add(token);

  const source = parseCanonicalRgba(tokens[token].fallback);
  if (!source) return null;
  const parent = THEME_TOKEN_REGISTRY[token].background;
  const background = parent === "canvas" ? canvas : compositeTokenBackground(parent, tokens, canvas, visited);
  if (!background) return null;
  return sourceOver(source, background);
}

export function validateThemeContrast(tokens: ThemeTokenMap, canvasColor: string): ContrastDiagnostic[] {
  const canvas = parseOpaqueCanvas(canvasColor);
  if (!canvas) {
    return [{
      path: "validationCanvas.color",
      code: "CONTRAST_TOO_LOW",
      message: "无法使用无效画布颜色计算对比度。",
      ratio: 0,
      minimum: 4.5,
    }];
  }

  const diagnostics: ContrastDiagnostic[] = [];

  for (const pair of CONTRAST_PAIRS_V1) {
    const background = compositeTokenBackground(pair.background, tokens, canvas);
    const foregroundSource = parseCanonicalRgba(tokens[pair.foreground].fallback);
    if (!background || !foregroundSource) continue;
    const foreground = sourceOver(foregroundSource, background);
    const ratio = contrastRatio(foreground, background);

    if (ratio + Number.EPSILON < pair.minimum) {
      diagnostics.push({
        path: `tokens.${pair.foreground}`,
        code: "CONTRAST_TOO_LOW",
        message: `${pair.label} 对比度为 ${ratio.toFixed(2)}:1，至少需要 ${pair.minimum}:1。`,
        ratio,
        minimum: pair.minimum,
      });
    }
  }

  return diagnostics;
}

export function compositeThemeBackground(tokens: ThemeTokenMap, canvasColor: string): string | null {
  const canvas = parseOpaqueCanvas(canvasColor);
  const background = parseCanonicalRgba(tokens.background.fallback);
  if (!canvas || !background) return null;
  const composed = sourceOver(background, canvas);
  return toCanonicalRgba({ ...composed, a: 1 }).slice(0, 7);
}
