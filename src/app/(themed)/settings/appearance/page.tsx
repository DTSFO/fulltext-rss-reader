import type { Metadata } from "next";

import { AppearanceSettings } from "@/features/appearance/components/appearance-settings";
import { getThemedPageAppearance } from "@/features/appearance/server/appearance-page";
import { listAppearanceThemes } from "@/features/appearance/server/appearance-query-service";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";

export const metadata: Metadata = { title: "外观设置" };

export default async function AppearanceSettingsPage() {
  const { user } = await getThemedPageAppearance();
  const firstPage = await listAppearanceThemes(user.id, {});
  return (
    <AppearanceSettings
      initialThemes={firstPage.items}
      initialNextCursor={firstPage.nextCursor}
      themeImportMaximumBytes={APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes}
      packageImportMaximumBytes={APPEARANCE_TECHNICAL_LIMITS.packageRequestBytes}
    />
  );
}
