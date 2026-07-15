import type { Metadata } from "next";

import { ReaderWorkspace } from "@/features/reader/components/reader-workspace";
import { getThemedPageAppearance } from "@/features/appearance/server/appearance-page";

export const metadata: Metadata = { title: "阅读器" };

export default async function ReaderPage() {
  const { user } = await getThemedPageAppearance();
  return <ReaderWorkspace username={user.username} />;
}
