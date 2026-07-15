import { compositeThemeBackground } from "@/features/appearance/color-math";
import {
  THEME_TOKEN_NAMES,
  THEME_TOKEN_REGISTRY,
  type AppearanceSnapshot,
  type AppliedTheme,
  type DeclaredScheme,
} from "@/features/appearance/theme-contract";

export const APPEARANCE_SCOPE_ID = "account-appearance-scope";

function fallbackDeclarations(theme: AppliedTheme): string {
  const declarations = THEME_TOKEN_NAMES.flatMap((name) => {
    const entry = THEME_TOKEN_REGISTRY[name];
    return [
      `${entry.fallbackCssVariable}:${theme.tokens[name].fallback}`,
      `${entry.cssVariable}:var(${entry.activeCssVariable},var(${entry.fallbackCssVariable}))`,
    ];
  });
  declarations.push(`color-scheme:${theme.declaredScheme}`);
  return declarations.join(";");
}

export function buildAppearanceFallbackCss(snapshot: AppearanceSnapshot): string {
  const selector = `#${APPEARANCE_SCOPE_ID}`;
  if (snapshot.config.mode === "light") {
    return `${selector}{${fallbackDeclarations(snapshot.lightTheme)}}`;
  }
  if (snapshot.config.mode === "dark") {
    return `${selector}{${fallbackDeclarations(snapshot.darkTheme)}}`;
  }
  return `${selector}{${fallbackDeclarations(snapshot.lightTheme)}}@media (prefers-color-scheme:dark){${selector}{${fallbackDeclarations(snapshot.darkTheme)}}}`;
}

export function appearanceThemeColor(theme: AppliedTheme): string {
  return compositeThemeBackground(theme.tokens, theme.validationCanvas.color) ?? theme.validationCanvas.color;
}

export function appearanceThemeColors(snapshot: AppearanceSnapshot): Array<{
  media?: string;
  color: string;
}> {
  if (snapshot.config.mode === "system") {
    return [
      { media: "(prefers-color-scheme: light)", color: appearanceThemeColor(snapshot.lightTheme) },
      { media: "(prefers-color-scheme: dark)", color: appearanceThemeColor(snapshot.darkTheme) },
    ];
  }
  const scheme: DeclaredScheme = snapshot.config.mode;
  return [{ color: appearanceThemeColor(scheme === "light" ? snapshot.lightTheme : snapshot.darkTheme) }];
}
