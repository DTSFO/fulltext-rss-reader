import { appearanceSnapshotDataSchema } from "@/features/appearance/schemas/appearance-schema";
import { browserApiRequest } from "@/lib/api/browser-api";

export const appearanceKeys = {
  all: ["appearance"] as const,
  snapshot: () => [...appearanceKeys.all, "snapshot"] as const,
  themes: (query: string) => [...appearanceKeys.all, "themes", query] as const,
  theme: (themeId: string) => [...appearanceKeys.all, "theme", themeId] as const,
};

export async function fetchAppearanceSnapshot() {
  const data = await browserApiRequest("/api/appearance", appearanceSnapshotDataSchema);
  return data.snapshot;
}
