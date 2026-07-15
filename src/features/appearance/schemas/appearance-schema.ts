import { z } from "zod";

import {
  APPEARANCE_PACKAGE_VERSION,
  BROWSER_VALIDATION_VERSION,
  DRAFT_CONTRACT_VERSION,
  SHORTCUT_CONFLICT_TABLE_VERSION,
  THEME_FILE_VERSION,
  THEME_TOKEN_NAMES,
  TOKEN_CONTRACT_VERSION,
} from "@/features/appearance/theme-contract";

export const declaredSchemeSchema = z.enum(["light", "dark"]);
export const appearanceModeSchema = z.enum(["light", "dark", "system"]);
export const canonicalRgbaSchema = z.string().regex(/^#[0-9a-f]{8}$/, "必须是小写 #rrggbbaa 颜色。");
export const opaqueCanvasSchema = z.string().regex(/^#[0-9a-f]{6}$/, "必须是小写且不透明的 #rrggbb 颜色。");
export const decimalBigintSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, "必须是非负十进制整数。");
export const sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/, "必须是小写 SHA-256 摘要。");
export const appearanceIdSchema = z.uuid();
export const themeNameSchema = z.string().trim().min(1, "主题名称不能为空。");
export const themeTokenNameSchema = z.enum(THEME_TOKEN_NAMES);

export const themeColorValueSchema = z.strictObject({
  expression: z.string(),
  fallback: canonicalRgbaSchema,
});

const themeTokenMapBaseSchema = z.record(themeTokenNameSchema, themeColorValueSchema);

export const themeTokenMapSchema = themeTokenMapBaseSchema.superRefine((tokens, context) => {
  for (const name of THEME_TOKEN_NAMES) {
    if (!(name in tokens)) {
      context.addIssue({ code: "custom", path: [name], message: "缺少颜色令牌。" });
    }
  }
});

export const validationCanvasSchema = z.strictObject({
  color: opaqueCanvasSchema,
  source: z.literal("browser-canvas"),
});

const browserValidationResultSchema = z.strictObject({
  expressionDigest: sha256DigestSchema,
  outcome: z.literal("computed"),
  computed: canonicalRgbaSchema,
});

const browserValidationResultsSchema = z
  .record(themeTokenNameSchema, browserValidationResultSchema)
  .superRefine((results, context) => {
    for (const name of THEME_TOKEN_NAMES) {
      if (!(name in results)) {
        context.addIssue({ code: "custom", path: [name], message: "浏览器报告缺少令牌结果。" });
      }
    }
  });

export const browserValidationReportV1Schema = z.strictObject({
  contractVersion: z.literal(BROWSER_VALIDATION_VERSION),
  expressionSetDigest: sha256DigestSchema,
  tokenContextDigest: sha256DigestSchema,
  declaredScheme: declaredSchemeSchema,
  results: browserValidationResultsSchema,
});

export const formalThemePayloadV1Schema = z.strictObject({
  tokenContractVersion: z.literal(TOKEN_CONTRACT_VERSION),
  tokens: themeTokenMapSchema,
  validationCanvas: validationCanvasSchema,
  browserValidation: browserValidationReportV1Schema.nullable(),
});

export const portableThemeV1Schema = formalThemePayloadV1Schema.extend({
  name: themeNameSchema,
  declaredScheme: declaredSchemeSchema,
});

export const themeSelectorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("builtin") }),
  z.strictObject({ kind: z.literal("custom"), themeId: z.uuid() }),
]);

const reservedBrowserShortcutCodes = new Set([
  "KeyA",
  "KeyB",
  "KeyC",
  "KeyD",
  "KeyE",
  "KeyF",
  "KeyG",
  "KeyH",
  "KeyI",
  "KeyJ",
  "KeyK",
  "KeyL",
  "KeyM",
  "KeyN",
  "KeyO",
  "KeyP",
  "KeyQ",
  "KeyR",
  "KeyS",
  "KeyT",
  "KeyU",
  "KeyV",
  "KeyW",
  "KeyX",
  "KeyY",
  "KeyZ",
  "Digit0",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Delete",
  "Escape",
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  "Minus",
  "Equal",
  "Comma",
  "BracketLeft",
  "BracketRight",
  "Backslash",
]);

const reservedAltShortcutCodes = new Set([
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "Escape",
  "Space",
  "Enter",
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
]);
const reservedNavigationShortcutCodes = new Set([
  "Tab",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Delete",
  "Escape",
  "Space",
  "Enter",
]);

export const recoveryShortcutSchema = z
  .strictObject({
    code: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, "快捷键必须使用 KeyboardEvent.code。"),
    ctrl: z.boolean(),
    alt: z.boolean(),
    meta: z.boolean(),
    shift: z.boolean(),
    conflictTableVersion: z.literal(SHORTCUT_CONFLICT_TABLE_VERSION),
  })
  .superRefine((shortcut, context) => {
    const primaryModifierCount = Number(shortcut.ctrl) + Number(shortcut.alt) + Number(shortcut.meta);
    if (primaryModifierCount === 0) {
      context.addIssue({ code: "custom", path: ["code"], message: "快捷键至少需要 Ctrl、Alt 或 Meta。" });
    }
    if (primaryModifierCount > 1) {
      context.addIssue({ code: "custom", path: ["code"], message: "不能组合多个系统主修饰键。" });
    }

    const conflictsWithBrowser =
      ((shortcut.ctrl || shortcut.meta) && !shortcut.alt && reservedBrowserShortcutCodes.has(shortcut.code)) ||
      (shortcut.alt && !shortcut.ctrl && !shortcut.meta && reservedAltShortcutCodes.has(shortcut.code)) ||
      reservedNavigationShortcutCodes.has(shortcut.code) ||
      (shortcut.meta && shortcut.code === "Space");
    if (conflictsWithBrowser) {
      context.addIssue({ code: "custom", path: ["code"], message: "该组合与常见浏览器或系统快捷键冲突。" });
    }
  });

export const appearanceConfigSchema = z.strictObject({
  mode: appearanceModeSchema,
  lightTheme: themeSelectorSchema,
  darkTheme: themeSelectorSchema,
  recoveryShortcut: recoveryShortcutSchema.nullable(),
  escapeRecoveryEnabled: z.boolean(),
});

export const appliedThemeSchema = portableThemeV1Schema.omit({ browserValidation: true }).extend({
  id: z.string().min(1),
  selector: themeSelectorSchema,
});

export const appearanceSnapshotSchema = z.strictObject({
  stateRevision: decimalBigintSchema,
  publishedRevision: decimalBigintSchema,
  config: appearanceConfigSchema,
  lightTheme: appliedThemeSchema,
  darkTheme: appliedThemeSchema,
});

export const appearanceSnapshotDataSchema = z.strictObject({ snapshot: appearanceSnapshotSchema });

export const themeSummarySchema = z.strictObject({
  id: z.uuid(),
  name: themeNameSchema,
  declaredScheme: declaredSchemeSchema,
  themeRevision: decimalBigintSchema,
  updatedAt: z.iso.datetime(),
  hasDraft: z.boolean(),
});

export const storedThemeSchema = portableThemeV1Schema.extend({
  id: z.uuid(),
  themeRevision: decimalBigintSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const draftColorValueSchema = z.strictObject({
  expression: z.string(),
  fallback: z.string(),
});

export const draftTokenMapSchema = z.partialRecord(themeTokenNameSchema, draftColorValueSchema);

export const looseThemeSnapshotV1Schema = z.strictObject({
  contractVersion: z.literal(DRAFT_CONTRACT_VERSION),
  tokens: draftTokenMapSchema,
  validationCanvas: z.strictObject({ color: z.string(), source: z.literal("browser-canvas") }),
  browserValidation: browserValidationReportV1Schema.nullable(),
});

export const storedDraftSchema = z.strictObject({
  contractVersion: z.literal(DRAFT_CONTRACT_VERSION),
  payload: looseThemeSnapshotV1Schema,
  baseThemeRevision: decimalBigintSchema,
  draftRevision: decimalBigintSchema,
  updatedAt: z.iso.datetime(),
});

export const themeDetailDataSchema = z.strictObject({
  theme: storedThemeSchema,
  draft: storedDraftSchema.nullable(),
});

export const themeListDataSchema = z.strictObject({
  items: z.array(themeSummarySchema),
  nextCursor: z.string().nullable(),
});

export const sourceSelectorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("builtin"), scheme: declaredSchemeSchema }),
  z.strictObject({ kind: z.literal("custom"), themeId: z.uuid(), expectedThemeRevision: decimalBigintSchema }),
]);

export const createThemeInputSchema = z.strictObject({
  operationId: z.uuid(),
  holderToken: z.string().min(32).max(256),
  name: themeNameSchema,
  declaredScheme: declaredSchemeSchema,
  source: sourceSelectorSchema,
  validationCanvas: validationCanvasSchema,
  browserValidation: browserValidationReportV1Schema.nullable(),
  keepLease: z.boolean().default(true),
});

export const leaseResourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("root") }),
  z.strictObject({ kind: z.literal("config") }),
  z.strictObject({ kind: z.literal("theme"), themeId: z.uuid() }),
]);

export const leaseHandleSchema = z.strictObject({
  resource: leaseResourceSchema,
  leaseId: z.uuid(),
  lockEpoch: decimalBigintSchema,
  fence: decimalBigintSchema,
  expiresAt: z.iso.datetime(),
  serverNow: z.iso.datetime(),
  requiresDraftResolution: z.boolean(),
});

export const leaseAcquireInputSchema = z.strictObject({
  holderToken: z.string().min(32).max(256),
  resources: z.array(leaseResourceSchema).min(1),
});

export const leaseHandleSetInputSchema = z.strictObject({
  holderToken: z.string().min(32).max(256),
  handles: z.array(leaseHandleSchema).min(1),
});

export const leaseSetDataSchema = z.strictObject({ handles: z.array(leaseHandleSchema) });
export const releaseLeaseDataSchema = z.strictObject({ released: z.boolean() });

export const createThemeDataSchema = z.union([
  z.strictObject({
    theme: storedThemeSchema,
    handle: leaseHandleSchema.nullable(),
    snapshot: appearanceSnapshotSchema,
  }),
  z.strictObject({
    kind: z.literal("operation-completed"),
    operation: z.enum(["create", "import"]),
    themeId: z.uuid(),
    themeRevision: decimalBigintSchema,
    stateRevision: decimalBigintSchema,
    publishedRevision: decimalBigintSchema,
    snapshot: appearanceSnapshotSchema,
  }),
]);

export const activeLeaseStatusSchema = z.strictObject({
  resource: leaseResourceSchema,
  expiresAt: z.iso.datetime(),
  serverNow: z.iso.datetime(),
  ownedByRequester: z.boolean(),
});

export const leaseStatusDataSchema = z.strictObject({
  items: z.array(activeLeaseStatusSchema),
  nextCursor: z.string().nullable(),
});

export const autosaveThemeInputSchema = z.strictObject({
  operationId: z.uuid(),
  holderToken: z.string().min(32).max(256),
  handle: leaseHandleSchema,
  expectedThemeRevision: decimalBigintSchema,
  expectedDraftRevision: decimalBigintSchema.nullable(),
  snapshot: looseThemeSnapshotV1Schema,
});

export const validationDiagnosticSchema = z.strictObject({
  path: z.string(),
  code: z.string(),
  message: z.string(),
  ratio: z.number().optional(),
  minimum: z.number().optional(),
});

const formalSavedDataSchema = z.strictObject({
  kind: z.literal("formal-saved"),
  theme: storedThemeSchema,
  snapshot: appearanceSnapshotSchema,
  stateRevision: decimalBigintSchema,
  publishedRevision: decimalBigintSchema,
});

const draftSavedDataSchema = z.strictObject({
  kind: z.literal("draft-saved"),
  draftRevision: decimalBigintSchema,
  stateRevision: decimalBigintSchema,
  diagnostics: z.array(validationDiagnosticSchema),
});

const autosaveOperationCompletedDataSchema = z.strictObject({
  kind: z.literal("operation-completed"),
  outcome: z.enum(["formal-saved", "draft-saved"]),
  themeId: z.uuid(),
  themeRevision: decimalBigintSchema.nullable(),
  draftRevision: decimalBigintSchema.nullable(),
  stateRevision: decimalBigintSchema,
  publishedRevision: decimalBigintSchema,
  diagnostics: z.array(validationDiagnosticSchema),
  snapshot: appearanceSnapshotSchema.nullable(),
});

export const autosaveThemeDataSchema = z.discriminatedUnion("kind", [
  formalSavedDataSchema,
  draftSavedDataSchema,
  autosaveOperationCompletedDataSchema,
]);

export const resolveDraftInputSchema = z.strictObject({
  operationId: z.uuid(),
  holderToken: z.string().min(32).max(256),
  handle: leaseHandleSchema,
  resolution: z.enum(["resume", "discard"]),
});

export const resolveDraftDataSchema = z.strictObject({
  resolved: z.boolean(),
  draft: storedDraftSchema.nullable(),
  stateRevision: decimalBigintSchema,
});

export const renameThemeInputSchema = z.strictObject({
  action: z.literal("rename"),
  operationId: z.uuid(),
  holderToken: z.string().min(32).max(256),
  handles: z.array(leaseHandleSchema),
  expectedStateRevision: decimalBigintSchema,
  name: themeNameSchema,
});

export const changeSchemeThemeInputSchema = z.strictObject({
  action: z.literal("change-scheme"),
  operationId: z.uuid(),
  holderToken: z.string().min(32).max(256),
  handles: z.array(leaseHandleSchema),
  expectedStateRevision: decimalBigintSchema,
  declaredScheme: declaredSchemeSchema,
  resolvedSystemSchemeAtConfirmation: declaredSchemeSchema,
  validationCanvas: validationCanvasSchema,
  browserValidation: browserValidationReportV1Schema.nullable(),
  impactDigest: sha256DigestSchema,
});

export const themeMutationInputSchema = z.discriminatedUnion("action", [
  renameThemeInputSchema,
  changeSchemeThemeInputSchema,
]);

export const resetThemeInputSchema = z.strictObject({
  operationId: z.uuid(),
  holderToken: z.string().min(32).max(256),
  handle: leaseHandleSchema,
  expectedThemeRevision: decimalBigintSchema,
  source: sourceSelectorSchema,
  validationCanvas: validationCanvasSchema,
  browserValidation: browserValidationReportV1Schema.nullable(),
});

export const deleteThemeInputSchema = z.strictObject({
  operationId: z.uuid(),
  holderToken: z.string().min(32).max(256),
  handles: z.array(leaseHandleSchema),
  expectedStateRevision: decimalBigintSchema,
  impactDigest: sha256DigestSchema,
  discardDraft: z.boolean(),
});

export const themeImpactSchema = z.strictObject({
  action: z.enum(["delete", "change-scheme"]),
  themeId: z.uuid(),
  stateRevision: decimalBigintSchema,
  affectedSlots: z.array(declaredSchemeSchema),
  currentlyActive: z.boolean(),
  displacedThemeId: z.uuid().nullable(),
  impactDigest: sha256DigestSchema,
});

export const themeMutationDataSchema = z.strictObject({
  theme: storedThemeSchema.optional(),
  deleted: z.boolean().optional(),
  snapshot: appearanceSnapshotSchema,
});

export const configMutationInputSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("set-mode"), operationId: z.uuid(), holderToken: z.string().min(32).max(256), mode: appearanceModeSchema }),
  z.strictObject({ action: z.literal("set-slot"), operationId: z.uuid(), holderToken: z.string().min(32).max(256), scheme: declaredSchemeSchema, selector: themeSelectorSchema }),
  z.strictObject({ action: z.literal("apply-theme"), operationId: z.uuid(), holderToken: z.string().min(32).max(256), themeId: z.uuid() }),
  z.strictObject({ action: z.literal("set-recovery"), operationId: z.uuid(), holderToken: z.string().min(32).max(256), recoveryShortcut: recoveryShortcutSchema.nullable(), escapeRecoveryEnabled: z.boolean() }),
]);

export const configMutationDataSchema = z.strictObject({ snapshot: appearanceSnapshotSchema });

export const themeFileV1Schema = z.strictObject({
  kind: z.literal("fulltext-rss-reader.theme"),
  version: z.literal(THEME_FILE_VERSION),
  theme: portableThemeV1Schema,
});

export const packageThemeV1Schema = portableThemeV1Schema.extend({ portableId: z.string().min(1) });

export const portableThemeSelectorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("builtin") }),
  z.strictObject({ kind: z.literal("custom"), portableId: z.string().min(1) }),
]);

export const appearancePackageV1Schema = z.strictObject({
  kind: z.literal("fulltext-rss-reader.appearance-package"),
  version: z.literal(APPEARANCE_PACKAGE_VERSION),
  config: z.strictObject({
    mode: appearanceModeSchema,
    lightTheme: portableThemeSelectorSchema,
    darkTheme: portableThemeSelectorSchema,
    recoveryShortcut: recoveryShortcutSchema.nullable(),
    escapeRecoveryEnabled: z.boolean(),
  }),
  themes: z.array(packageThemeV1Schema),
});

export const importThemeInputSchema = z.strictObject({
  operationId: z.uuid(),
  holderToken: z.string().min(32).max(256),
  file: themeFileV1Schema,
  editAfterImport: z.boolean().default(false),
});

export const restorePreviewInputSchema = z.strictObject({
  operationId: z.uuid(),
  file: appearancePackageV1Schema,
});

export const restoreSummarySchema = z.strictObject({
  existingThemeCount: z.number().int().nonnegative(),
  incomingThemeCount: z.number().int().nonnegative(),
  removedDraftCount: z.number().int().nonnegative(),
  modeBefore: appearanceModeSchema,
  modeAfter: appearanceModeSchema,
});

export const restorePreviewDataSchema = z.strictObject({
  planId: z.uuid(),
  expectedStateRevision: decimalBigintSchema,
  payloadDigest: sha256DigestSchema,
  expiresAt: z.iso.datetime(),
  summary: restoreSummarySchema,
});

export const restoreConfirmInputSchema = z.strictObject({
  operationId: z.uuid(),
  holderToken: z.string().min(32).max(256),
  handle: leaseHandleSchema,
  payloadDigest: sha256DigestSchema,
  expectedStateRevision: decimalBigintSchema,
});

export const recoveryInputSchema = z.strictObject({ operationId: z.uuid() });
export const recoveryDataSchema = z.strictObject({ snapshot: appearanceSnapshotSchema });

const receiptRevisionFields = {
  stateRevision: decimalBigintSchema,
  publishedRevision: decimalBigintSchema,
} as const;

/**
 * Versioned safe idempotency results. These deliberately exclude theme token
 * payloads, drafts, browser reports and holder credentials.
 */
export const mutationReceiptSafeResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("theme-created"),
    operation: z.enum(["create", "import"]),
    themeId: z.uuid(),
    handle: leaseHandleSchema.nullable(),
    themeRevision: decimalBigintSchema,
    ...receiptRevisionFields,
  }),
  z.strictObject({
    kind: z.literal("formal-saved"),
    themeId: z.uuid(),
    themeRevision: decimalBigintSchema,
    ...receiptRevisionFields,
  }),
  z.strictObject({
    kind: z.literal("draft-saved"),
    themeId: z.uuid(),
    draftRevision: decimalBigintSchema,
    diagnostics: z.array(validationDiagnosticSchema),
    ...receiptRevisionFields,
  }),
  z.strictObject({
    kind: z.literal("draft-resolved"),
    themeId: z.uuid(),
    resolution: z.enum(["resume", "discard"]),
    draftRevision: decimalBigintSchema.nullable(),
    ...receiptRevisionFields,
  }),
  z.strictObject({
    kind: z.literal("theme-mutated"),
    operation: z.enum(["reset", "rename", "change-scheme"]),
    themeId: z.uuid(),
    themeRevision: decimalBigintSchema,
    ...receiptRevisionFields,
  }),
  z.strictObject({
    kind: z.literal("theme-deleted"),
    themeId: z.uuid(),
    ...receiptRevisionFields,
  }),
  z.strictObject({ kind: z.literal("config-updated"), ...receiptRevisionFields }),
  z.strictObject({ kind: z.literal("appearance-recovered"), ...receiptRevisionFields }),
  z.strictObject({
    kind: z.literal("package-restore-previewed"),
    planId: z.uuid(),
    payloadDigest: sha256DigestSchema,
    expiresAt: z.iso.datetime(),
    summary: restoreSummarySchema,
    ...receiptRevisionFields,
  }),
  z.strictObject({ kind: z.literal("package-restored"), ...receiptRevisionFields }),
]);


export type DeclaredScheme = z.infer<typeof declaredSchemeSchema>;
export type AppearanceConfig = z.infer<typeof appearanceConfigSchema>;
export type FormalThemePayloadV1 = z.infer<typeof formalThemePayloadV1Schema>;
export type BrowserValidationReportV1 = z.infer<typeof browserValidationReportV1Schema>;
export type PortableThemeV1 = z.infer<typeof portableThemeV1Schema>;
export type AppearanceSnapshot = z.infer<typeof appearanceSnapshotSchema>;
export type StoredTheme = z.infer<typeof storedThemeSchema>;
export type LooseThemeSnapshotV1 = z.infer<typeof looseThemeSnapshotV1Schema>;
export type LeaseResource = z.infer<typeof leaseResourceSchema>;
export type LeaseHandle = z.infer<typeof leaseHandleSchema>;
export type ConfigMutationInput = z.infer<typeof configMutationInputSchema>;
export type AppearancePackageV1 = z.infer<typeof appearancePackageV1Schema>;
export type MutationReceiptSafeResult = z.infer<typeof mutationReceiptSafeResultSchema>;
