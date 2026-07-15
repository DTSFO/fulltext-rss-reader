import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("appearance restore timeout contract", () => {
  it("keeps the 120-second final-apply budget and installs it inside the leased transaction", () => {
    const limitsSource = readFileSync(
      `${process.cwd()}/src/features/appearance/server/technical-limits.ts`,
      "utf8",
    );
    expect(limitsSource).toMatch(/snapshotTimeoutMs:\s*120_000/);
    const source = readFileSync(
      `${process.cwd()}/src/features/appearance/server/appearance-transfer-service.ts`,
      "utf8",
    );
    const leasedRestore = source.slice(source.indexOf("export async function confirmAppearanceRestore"));
    expect(leasedRestore).toContain(
      "set local statement_timeout = '${APPEARANCE_TECHNICAL_LIMITS.snapshotTimeoutMs}ms'",
    );
    expect(leasedRestore.indexOf("set local statement_timeout")).toBeLessThan(
      leasedRestore.indexOf("const [plan]"),
    );
  });
});
