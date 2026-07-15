import "server-only";

import type { PortableThemeV1 } from "@/features/appearance/schemas/appearance-schema";
import {
  BROWSER_VALIDATION_VERSION,
  THEME_TOKEN_NAMES,
  type BrowserValidationReportV1,
  type DeclaredScheme,
} from "@/features/appearance/theme-contract";

const ZERO_DIGEST = "0".repeat(64);
const OPERATION_ID = "00000000-0000-4000-8000-000000000000";
const MAXIMUM_HOLDER_TOKEN = "0".repeat(256);

function maximumBrowserValidationReport(declaredScheme: DeclaredScheme): BrowserValidationReportV1 {
  return {
    contractVersion: BROWSER_VALIDATION_VERSION,
    expressionSetDigest: ZERO_DIGEST,
    tokenContextDigest: ZERO_DIGEST,
    declaredScheme,
    results: Object.fromEntries(THEME_TOKEN_NAMES.map((name) => [
      name,
      {
        expressionDigest: ZERO_DIGEST,
        outcome: "computed" as const,
        computed: "#00000000",
      },
    ])) as BrowserValidationReportV1["results"],
  };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function browserValidationImportExpansionBytes(theme: PortableThemeV1): number {
  if (theme.browserValidation) return 0;
  return byteLength(maximumBrowserValidationReport(theme.declaredScheme)) - byteLength(null);
}

export function projectedThemeImportRequestBytes<T extends { theme: PortableThemeV1 }>(
  file: T,
): number {
  return byteLength({
    operationId: OPERATION_ID,
    holderToken: MAXIMUM_HOLDER_TOKEN,
    file: {
      ...file,
      theme: {
        ...file.theme,
        browserValidation: file.theme.browserValidation ??
          maximumBrowserValidationReport(file.theme.declaredScheme),
      },
    },
    editAfterImport: true,
  });
}

const PACKAGE_IMPORT_ENVELOPE_BYTES = byteLength({ operationId: OPERATION_ID, file: null }) - byteLength(null);

export function projectedPackageImportRequestBytes(
  portableFileBytes: number,
  reportExpansionBytes: number,
): number {
  return portableFileBytes + reportExpansionBytes + PACKAGE_IMPORT_ENVELOPE_BYTES;
}
