import type { Metadata } from "next";

import { RecoveryPanel } from "@/features/appearance/components/recovery-panel";
import { requirePageUser } from "@/features/auth/server/session";

export const metadata: Metadata = { title: "安全恢复外观" };

export default async function AppearanceRecoveryPage() {
  await requirePageUser();
  return <RecoveryPanel />;
}
