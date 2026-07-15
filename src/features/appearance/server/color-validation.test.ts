import { beforeAll, describe, expect, it, vi } from "vitest";

import { BUILTIN_THEMES, cloneThemeTokens } from "@/features/appearance/theme-contract";

vi.mock("server-only", () => ({}));

type Module = typeof import("@/features/appearance/server/color-validation");
type LimitsModule = typeof import("@/features/appearance/server/technical-limits");
let validation: Module;
let limits: LimitsModule["APPEARANCE_TECHNICAL_LIMITS"];

beforeAll(async () => {
  [validation, { APPEARANCE_TECHNICAL_LIMITS: limits }] = await Promise.all([
    import("@/features/appearance/server/color-validation"),
    import("@/features/appearance/server/technical-limits"),
  ]);
});

const injectionCorpus = [
  "red; background: blue",
  "var(--x);--evil:red",
  "url(https://example.com/pixel)",
  "rgb(1 2 3) !important",
  "red/**/",
  "@import 'x'",
  "</style><script>alert(1)</script>",
  "linear-gradient(red, blue)",
  "rotate(1deg)",
  "translate(1px)",
  "blur(1px)",
  "filter(contrast(2))",
  "image(red)",
  "calc(1px)",
  "1px",
  "0 18px 50px black",
  "\u0000red",
];

describe("server CSS color validation", () => {
  it.each(injectionCorpus)("rejects unsafe or non-color input: %s", (expression) => {
    expect(validation.validateCssColorExpression(expression).valid).toBe(false);
  });

  it("accepts deterministic colors and classifies browser-only system colors", () => {
    expect(validation.validateCssColorExpression("color-mix(in oklab, red, blue)")).toMatchObject({
      valid: true,
      kind: "deterministic",
    });
    expect(validation.validateCssColorExpression("Canvas")).toMatchObject({
      valid: true,
      kind: "browser-only",
    });
  });

  it("enforces expression byte and nesting limits at their exact boundaries", () => {
    const expressionAtBytes = `var(--${"x".repeat(limits.expressionBytes - 7)})`;
    const expressionAboveBytes = `${expressionAtBytes}x`;
    expect(Buffer.byteLength(expressionAtBytes, "utf8")).toBe(limits.expressionBytes);
    expect(validation.validateCssColorExpression(expressionAtBytes)).toMatchObject({ valid: true });
    expect(validation.validateCssColorExpression(expressionAboveBytes)).toMatchObject({
      valid: false,
      diagnostic: { code: "EXPRESSION_TOO_LARGE" },
    });

    const nested = (depth: number) => `${"var(--x,".repeat(depth)}red${")".repeat(depth)}`;
    expect(validation.validateCssColorExpression(nested(limits.expressionNesting))).toMatchObject({ valid: true });
    expect(validation.validateCssColorExpression(nested(limits.expressionNesting + 1))).toMatchObject({
      valid: false,
      diagnostic: { code: "EXPRESSION_TOO_LARGE" },
    });
  });

  it("keeps browser-only color roots forward-compatible while rejecting known non-color roots", () => {
    expect(validation.validateCssColorExpression("currentColor")).toMatchObject({ valid: true, kind: "browser-only" });
    expect(validation.validateCssColorExpression("AccentColor")).toMatchObject({ valid: true, kind: "browser-only" });
    expect(validation.validateCssColorExpression("var(--external, CanvasText)")).toMatchObject({ valid: true });
    expect(validation.validateCssColorExpression("future-color(red)")).toMatchObject({ valid: true, kind: "browser-only" });
    expect(validation.validateCssColorExpression("future-system-color")).toMatchObject({ valid: true, kind: "browser-only" });
    expect(validation.validateCssColorExpression("rotate(1deg)").valid).toBe(false);
    expect(validation.validateCssColorExpression("calc(1px)").valid).toBe(false);
  });

  it("rejects self and multi-token var cycles from a formal snapshot", () => {
    const selfCycle = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    selfCycle.background.expression = "var(--background)";
    const selfResult = validation.validateFormalTheme({
      tokenContractVersion: 1,
      tokens: selfCycle,
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
    }, "light");
    expect(selfResult).toMatchObject({ success: false });
    if (selfResult.success) throw new Error("Expected self-cycle diagnostics.");
    expect(selfResult.diagnostics.some((item) => item.code === "EXPRESSION_CYCLE")).toBe(true);

    const multiCycle = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    multiCycle.background.expression = "var(--surface)";
    multiCycle.surface.expression = "var(--surface-raised)";
    multiCycle.surfaceRaised.expression = "var(--background)";
    const multiResult = validation.validateFormalTheme({
      tokenContractVersion: 1,
      tokens: multiCycle,
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
    }, "light");
    expect(multiResult).toMatchObject({ success: false });
    if (multiResult.success) throw new Error("Expected multi-token cycle diagnostics.");
    expect(multiResult.diagnostics.filter((item) => item.code === "EXPRESSION_CYCLE")).toHaveLength(3);
  });

  it("enforces the exact browser report context digest", () => {
    const tokens = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    tokens.background = { expression: "Canvas", fallback: "#ffffffff" };
    const payload = {
      tokenContractVersion: 1 as const,
      tokens,
      validationCanvas: { color: "#ffffff", source: "browser-canvas" as const },
      browserValidation: null,
    };
    const missing = validation.validateFormalTheme(payload, "light");
    expect(missing).toMatchObject({ success: false });
    if (missing.success) throw new Error("Expected missing report diagnostics.");
    expect(missing.diagnostics.some((item) => item.code === "BROWSER_VALIDATION_REQUIRED")).toBe(true);

    const digests = validation.computeBrowserValidationDigests(tokens, payload.validationCanvas, "light");
    const report = {
      contractVersion: 1 as const,
      expressionSetDigest: digests.expressionSetDigest,
      tokenContextDigest: digests.tokenContextDigest,
      declaredScheme: "light" as const,
      results: Object.fromEntries(
        Object.entries(digests.expressionDigests).map(([name, expressionDigest]) => [
          name,
          { expressionDigest, outcome: "computed" as const, computed: tokens[name as keyof typeof tokens].fallback },
        ]),
      ),
    };
    expect(validation.validateFormalTheme({ ...payload, browserValidation: report }, "light")).toMatchObject({ success: true });
    expect(validation.validateFormalTheme({ ...payload, validationCanvas: { ...payload.validationCanvas, color: "#fffffe" }, browserValidation: report }, "light")).toMatchObject({ success: false });
  });

  it("allows a structurally safe browser-new color only with a matching full report", () => {
    const tokens = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    tokens.background.expression = "future-color(red)";
    const digests = validation.computeBrowserValidationDigests(tokens, BUILTIN_THEMES.light.validationCanvas, "light");
    const report = {
      contractVersion: 1 as const,
      expressionSetDigest: digests.expressionSetDigest,
      tokenContextDigest: digests.tokenContextDigest,
      declaredScheme: "light" as const,
      results: Object.fromEntries(
        Object.entries(digests.expressionDigests).map(([name, expressionDigest]) => [
          name,
          { expressionDigest, outcome: "computed" as const, computed: tokens[name as keyof typeof tokens].fallback },
        ]),
      ),
    };
    expect(validation.validateFormalTheme({
      tokenContractVersion: 1,
      tokens,
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
    }, "light")).toMatchObject({ success: false });
    expect(validation.validateFormalTheme({
      tokenContractVersion: 1,
      tokens,
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: report,
    }, "light")).toMatchObject({ success: true });
  });

  it("does not let a forged matching report bypass the structural injection boundary", () => {
    const tokens = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    tokens.background.expression = "red; background: blue";
    const digests = validation.computeBrowserValidationDigests(tokens, BUILTIN_THEMES.light.validationCanvas, "light");
    const report = {
      contractVersion: 1 as const,
      expressionSetDigest: digests.expressionSetDigest,
      tokenContextDigest: digests.tokenContextDigest,
      declaredScheme: "light" as const,
      results: Object.fromEntries(
        Object.entries(digests.expressionDigests).map(([name, expressionDigest]) => [
          name,
          { expressionDigest, outcome: "computed" as const, computed: tokens[name as keyof typeof tokens].fallback },
        ]),
      ),
    };
    const result = validation.validateFormalTheme({
      tokenContractVersion: 1,
      tokens,
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: report,
    }, "light");
    expect(result).toMatchObject({ success: false });
    if (result.success) throw new Error("Expected structural diagnostics.");
    expect(result.diagnostics.some((item) => item.code === "EXPRESSION_UNSAFE")).toBe(true);
  });

  it("validates a supplied report even when every expression is deterministic", () => {
    const tokens = cloneThemeTokens(BUILTIN_THEMES.light.tokens);
    const digests = validation.computeBrowserValidationDigests(tokens, BUILTIN_THEMES.light.validationCanvas, "light");
    const staleReport = {
      contractVersion: 1 as const,
      expressionSetDigest: "0".repeat(64),
      tokenContextDigest: digests.tokenContextDigest,
      declaredScheme: "light" as const,
      results: Object.fromEntries(
        Object.entries(digests.expressionDigests).map(([name, expressionDigest]) => [
          name,
          { expressionDigest, outcome: "computed" as const, computed: tokens[name as keyof typeof tokens].fallback },
        ]),
      ),
    };
    const result = validation.validateFormalTheme({
      tokenContractVersion: 1,
      tokens,
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: staleReport,
    }, "light");
    expect(result).toMatchObject({ success: false });
    if (result.success) throw new Error("Expected stale-report diagnostics.");
    expect(result.diagnostics.some((item) => item.code === "BROWSER_VALIDATION_MISMATCH")).toBe(true);
  });

  it("rejects unsafe loose snapshots without overwriting anything", () => {
    expect(validation.validateLooseThemeSnapshot({
      contractVersion: 1,
      tokens: { background: { expression: "red\u0000", fallback: "" } },
      validationCanvas: { color: "", source: "browser-canvas" },
      browserValidation: null,
    })).toMatchObject({ success: false });
  });
});
