import "server-only";

import { cache } from "react";

import { getAppearanceSnapshot } from "@/features/appearance/server/appearance-query-service";
import { requirePageUser } from "@/features/auth/server/session";

export const getThemedPageAppearance = cache(async () => {
  const user = await requirePageUser();
  const snapshot = await getAppearanceSnapshot(user.id);
  return { user, snapshot };
});
