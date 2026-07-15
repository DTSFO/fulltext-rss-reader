import type { Viewport } from "next";

import {
  appearanceThemeColors,
  buildAppearanceFallbackCss,
  APPEARANCE_SCOPE_ID,
} from "@/features/appearance/appearance-css";
import { DEFAULT_APPEARANCE_SNAPSHOT } from "@/features/appearance/theme-contract";

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: appearanceThemeColors(DEFAULT_APPEARANCE_SNAPSHOT),
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id={APPEARANCE_SCOPE_ID} className="appearance-scope min-h-dvh">
      <style>{buildAppearanceFallbackCss(DEFAULT_APPEARANCE_SNAPSHOT)}</style>
      {children}
    </div>
  );
}
