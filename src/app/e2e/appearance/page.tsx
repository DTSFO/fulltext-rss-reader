import { notFound } from "next/navigation";

import { APPEARANCE_SCOPE_ID, buildAppearanceFallbackCss } from "@/features/appearance/appearance-css";
import { AppearanceProvider } from "@/features/appearance/components/appearance-provider";
import { AppearanceSettings } from "@/features/appearance/components/appearance-settings";
import {
  DEFAULT_APPEARANCE_SNAPSHOT,
  SHORTCUT_CONFLICT_TABLE_VERSION,
} from "@/features/appearance/theme-contract";

const themeId = "44444444-4444-4444-8444-444444444444";
const initialSnapshot = {
  ...DEFAULT_APPEARANCE_SNAPSHOT,
  config: {
    ...DEFAULT_APPEARANCE_SNAPSHOT.config,
    recoveryShortcut: {
      code: "KeyY",
      ctrl: false,
      alt: true,
      meta: false,
      shift: true,
      conflictTableVersion: SHORTCUT_CONFLICT_TABLE_VERSION,
    },
  },
};

export default function E2EAppearancePage() {
  if (process.env.E2E_TEST_MODE !== "true") notFound();

  return (
    <div id={APPEARANCE_SCOPE_ID} className="appearance-scope min-h-dvh">
      <style>{buildAppearanceFallbackCss(initialSnapshot)}</style>
      <AppearanceProvider initialSnapshot={initialSnapshot}>
        <AppearanceSettings
          initialThemes={[
            {
              id: themeId,
              name: "E2E Paper",
              declaredScheme: "light",
              themeRevision: "1",
              updatedAt: "2026-07-13T00:00:00.000Z",
              hasDraft: false,
            },
          ]}
          initialNextCursor={null}
          themeImportMaximumBytes={2 * 1024 * 1024}
          packageImportMaximumBytes={64 * 1024 * 1024}
        />
      </AppearanceProvider>
    </div>
  );
}
