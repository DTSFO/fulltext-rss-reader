import type { AppearanceMode, DeclaredScheme } from "@/features/appearance/theme-contract";

export type ThemeSchemeConfigState = {
  mode: AppearanceMode;
  lightThemeId: string | null;
  darkThemeId: string | null;
};

export type ThemeSchemeImpactPayload = {
  action: "change-scheme";
  themeId: string;
  stateRevision: string;
  oldScheme: DeclaredScheme;
  newScheme: DeclaredScheme;
  mode: AppearanceMode;
  lightThemeId: string | null;
  darkThemeId: string | null;
  resolvedSystemSchemeAtConfirmation: DeclaredScheme;
  validationCanvasColor: string;
};

export type ThemeSchemeTransition = {
  affectedSlots: DeclaredScheme[];
  currentlyActive: boolean;
  displacedThemeId: string | null;
  nextConfig: ThemeSchemeConfigState;
  impactPayload: ThemeSchemeImpactPayload;
};

function slotThemeId(config: ThemeSchemeConfigState, scheme: DeclaredScheme): string | null {
  return scheme === "light" ? config.lightThemeId : config.darkThemeId;
}

/** Derives both the user-confirmed impact and the exact atomic config transition. */
export function deriveThemeSchemeTransition(input: {
  themeId: string;
  stateRevision: string;
  oldScheme: DeclaredScheme;
  newScheme: DeclaredScheme;
  config: ThemeSchemeConfigState;
  resolvedSystemSchemeAtConfirmation: DeclaredScheme;
  validationCanvasColor: string;
}): ThemeSchemeTransition {
  if (input.oldScheme === input.newScheme) {
    throw new RangeError("A theme scheme transition must change the declared scheme.");
  }

  const affectedSlots = (["light", "dark"] as const).filter(
    (scheme) => slotThemeId(input.config, scheme) === input.themeId,
  );
  const oldSlotReferencesTarget = slotThemeId(input.config, input.oldScheme) === input.themeId;
  const currentlyActive =
    oldSlotReferencesTarget &&
    (input.config.mode === input.oldScheme ||
      (input.config.mode === "system" && input.resolvedSystemSchemeAtConfirmation === input.oldScheme));
  const targetSlotThemeId = slotThemeId(input.config, input.newScheme);

  let lightThemeId = input.config.lightThemeId;
  let darkThemeId = input.config.darkThemeId;
  if (input.oldScheme === "light" && lightThemeId === input.themeId) lightThemeId = null;
  if (input.oldScheme === "dark" && darkThemeId === input.themeId) darkThemeId = null;
  if (input.newScheme === "light") lightThemeId = input.themeId;
  else darkThemeId = input.themeId;

  return {
    affectedSlots,
    currentlyActive,
    displacedThemeId: targetSlotThemeId === input.themeId ? null : targetSlotThemeId,
    nextConfig: {
      mode: currentlyActive ? input.newScheme : input.config.mode,
      lightThemeId,
      darkThemeId,
    },
    impactPayload: {
      action: "change-scheme",
      themeId: input.themeId,
      stateRevision: input.stateRevision,
      oldScheme: input.oldScheme,
      newScheme: input.newScheme,
      mode: input.config.mode,
      lightThemeId: input.config.lightThemeId,
      darkThemeId: input.config.darkThemeId,
      resolvedSystemSchemeAtConfirmation: input.resolvedSystemSchemeAtConfirmation,
      validationCanvasColor: input.validationCanvasColor,
    },
  };
}
