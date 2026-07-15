import type { Viewport } from "next";

import {
  APPEARANCE_SCOPE_ID,
  appearanceThemeColors,
  buildAppearanceFallbackCss,
} from "@/features/appearance/appearance-css";
import { AppearanceProvider } from "@/features/appearance/components/appearance-provider";
import { getThemedPageAppearance } from "@/features/appearance/server/appearance-page";

export async function generateViewport(): Promise<Viewport> {
  const { snapshot } = await getThemedPageAppearance();
  return {
    colorScheme: snapshot.config.mode === "system" ? "light dark" : snapshot.config.mode,
    themeColor: appearanceThemeColors(snapshot),
  };
}

export default async function ThemedLayout({ children }: { children: React.ReactNode }) {
  const { snapshot } = await getThemedPageAppearance();

  return (
    <div id={APPEARANCE_SCOPE_ID} className="appearance-scope min-h-dvh">
      <style>{buildAppearanceFallbackCss(snapshot)}</style>
      <AppearanceProvider initialSnapshot={snapshot}>{children}</AppearanceProvider>
    </div>
  );
}
