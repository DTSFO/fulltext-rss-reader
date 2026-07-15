import { notFound } from "next/navigation";

import { APPEARANCE_SCOPE_ID, buildAppearanceFallbackCss } from "@/features/appearance/appearance-css";
import { DEFAULT_APPEARANCE_SNAPSHOT } from "@/features/appearance/theme-contract";
import { ReaderWorkspace } from "@/features/reader/components/reader-workspace";

export default function E2EReaderPage() {
  if (process.env.E2E_TEST_MODE !== "true") {
    notFound();
  }

  return (
    <div id={APPEARANCE_SCOPE_ID} className="appearance-scope min-h-dvh">
      <style>{buildAppearanceFallbackCss(DEFAULT_APPEARANCE_SNAPSHOT)}</style>
      <ReaderWorkspace username="e2e-user" />
    </div>
  );
}
