import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import {
  appearanceConfigs,
  appearanceLeases,
  appearanceLockState,
  appearanceThemeDrafts,
  appearanceThemes,
} from "@/db/schema";
import {
  autosaveThemeInputSchema,
  configMutationInputSchema,
  createThemeInputSchema,
  deleteThemeInputSchema,
  recoveryInputSchema,
  resetThemeInputSchema,
  resolveDraftInputSchema,
  themeMutationInputSchema,
  type LeaseHandle,
} from "@/features/appearance/schemas/appearance-schema";
import {
  BUILTIN_THEMES,
  DRAFT_CONTRACT_VERSION,
  TOKEN_CONTRACT_VERSION,
  cloneThemeTokens,
  type BrowserValidationReportV1,
  type DeclaredScheme,
  type FormalThemePayloadV1,
  type ThemeTokenMap,
} from "@/features/appearance/theme-contract";
import { deriveThemeSchemeTransition } from "@/features/appearance/theme-scheme-transition";
import { selectorToId } from "@/features/appearance/server/appearance-codec";
import type { AppearanceTransaction } from "@/features/appearance/server/appearance-db";
import {
  assertRootAvailable,
  bumpAppearanceRevision,
  claimOneShotConfigLease,
  createThemeLeaseRow,
  readMutationReceipt,
  releaseOneShotLease,
  replayMutationReceipt,
  replayableReceiptHandle,
  replayableReceiptHandleInTransaction,
  requestDigest,
  withAppearanceGate,
  withAppearanceLeases,
  writeMutationReceipt,
} from "@/features/appearance/server/appearance-db";
import {
  validateFormalTheme,
  validateLooseThemeSnapshot,
  type AppearanceDiagnostic,
} from "@/features/appearance/server/color-validation";
import {
  getAppearanceSnapshot,
  getAppearanceTheme,
  getFormalTheme,
} from "@/features/appearance/server/appearance-query-service";
import { assertDemoCapacity } from "@/lib/config/demo-policy";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";

type CreateThemeInput = z.infer<typeof createThemeInputSchema>;
type ResetThemeInput = z.infer<typeof resetThemeInputSchema>;

function mapThemeWriteError(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "23505") {
    throw new AppError({
      code: "APPEARANCE_NAME_CONFLICT",
      message: "主题名称已存在，请使用其他名称。",
      status: 409,
      cause: error,
    });
  }
  throw error;
}

function strictValidationError(diagnostics: AppearanceDiagnostic[]): AppError {
  const browserRequired = diagnostics.some(
    (diagnostic) => diagnostic.code === "BROWSER_VALIDATION_REQUIRED" || diagnostic.code === "BROWSER_VALIDATION_MISMATCH",
  );
  return new AppError({
    code: browserRequired ? "APPEARANCE_BROWSER_VALIDATION_REQUIRED" : "APPEARANCE_VALIDATION_FAILED",
    message: browserRequired ? "当前浏览器需要重新验证主题中的动态颜色。" : "主题未通过正式保存校验。",
    status: 422,
    details: { diagnostics },
  });
}

async function readSourceTokens(
  accountId: string,
  source: CreateThemeInput["source"] | ResetThemeInput["source"],
): Promise<ThemeTokenMap> {
  if (source.kind === "builtin") return cloneThemeTokens(BUILTIN_THEMES[source.scheme].tokens);
  const theme = await getFormalTheme(accountId, source.themeId);
  if (theme.themeRevision !== source.expectedThemeRevision) {
    throw new AppError({
      code: "APPEARANCE_RECONFIRM_REQUIRED",
      message: "来源主题已变化，请重新确认。",
      status: 409,
    });
  }
  return cloneThemeTokens(theme.tokens);
}

function formalPayload(
  tokens: ThemeTokenMap,
  validationCanvas: FormalThemePayloadV1["validationCanvas"],
  browserValidation: BrowserValidationReportV1 | null,
): FormalThemePayloadV1 {
  return { tokenContractVersion: TOKEN_CONTRACT_VERSION, tokens, validationCanvas, browserValidation };
}

async function assertSourceStillCurrent(
  tx: AppearanceTransaction,
  accountId: string,
  source: CreateThemeInput["source"] | ResetThemeInput["source"],
): Promise<void> {
  if (source.kind === "builtin") return;
  const [theme] = await tx
    .select({ themeRevision: appearanceThemes.themeRevision })
    .from(appearanceThemes)
    .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, source.themeId)))
    .limit(1)
    .for("share");
  if (!theme) {
    throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "来源主题不存在。", status: 404 });
  }
  if (theme.themeRevision.toString() !== source.expectedThemeRevision) {
    throw new AppError({ code: "APPEARANCE_RECONFIRM_REQUIRED", message: "来源主题已变化，请重新确认。", status: 409 });
  }
}

async function replayedThemeMutationResult(accountId: string, themeId: string) {
  try {
    return {
      theme: (await getAppearanceTheme(accountId, themeId)).theme,
      snapshot: await getAppearanceSnapshot(accountId),
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "APPEARANCE_NOT_FOUND") {
      return { snapshot: await getAppearanceSnapshot(accountId) };
    }
    throw error;
  }
}

async function replayedDraftResolutionResult(
  accountId: string,
  themeId: string,
  stateRevision: string,
) {
  try {
    return {
      resolved: true,
      draft: (await getAppearanceTheme(accountId, themeId)).draft,
      stateRevision,
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "APPEARANCE_NOT_FOUND") {
      return { resolved: true, draft: null, stateRevision };
    }
    throw error;
  }
}

function assertThemeMutationHandles(
  handles: LeaseHandle[],
  themeId: string,
  includeConfig: boolean,
): void {
  const identities = new Set(
    handles.map((handle) =>
      handle.resource.kind === "theme" ? `theme:${handle.resource.themeId}` : handle.resource.kind,
    ),
  );
  const expected = new Set(includeConfig ? ["config", `theme:${themeId}`] : [`theme:${themeId}`]);
  if (identities.size !== expected.size || [...expected].some((identity) => !identities.has(identity))) {
    throw new AppError({
      code: "APPEARANCE_LEASE_LOST",
      message: "外观操作没有提交完整且匹配的租约集合。",
      status: 409,
    });
  }
}

export async function createAppearanceTheme(accountId: string, rawInput: unknown) {
  const input = createThemeInputSchema.parse(rawInput);
  const digestValue = requestDigest({
    name: input.name,
    declaredScheme: input.declaredScheme,
    source: input.source,
    validationCanvas: input.validationCanvas,
    browserValidation: input.browserValidation,
    keepLease: input.keepLease,
  });
  const replay = await replayMutationReceipt(accountId, input.operationId, "theme.create", digestValue);
  if (replay) {
    if (replay.kind !== "theme-created" || replay.operation !== "create") {
      throw new Error("Theme create receipt has an unexpected result kind.");
    }
    const snapshot = await getAppearanceSnapshot(accountId);
    try {
      return {
        theme: (await getAppearanceTheme(accountId, replay.themeId)).theme,
        handle: await replayableReceiptHandle(accountId, input.holderToken, replay.handle),
        snapshot,
      };
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "APPEARANCE_NOT_FOUND") throw error;
      return {
        kind: "operation-completed" as const,
        operation: "create" as const,
        themeId: replay.themeId,
        themeRevision: replay.themeRevision,
        stateRevision: replay.stateRevision,
        publishedRevision: replay.publishedRevision,
        snapshot,
      };
    }
  }

  const tokens = await readSourceTokens(accountId, input.source);
  const payload = formalPayload(tokens, input.validationCanvas, input.browserValidation);
  const validation = validateFormalTheme(payload, input.declaredScheme);
  if (!validation.success) throw strictValidationError(validation.diagnostics);

  let themeId = "";
  let handle: LeaseHandle | null = null;
  try {
    await withAppearanceGate(accountId, async (tx, revision) => {
      const receipt = await readMutationReceipt(
        tx,
        accountId,
        input.operationId,
        "theme.create",
        digestValue,
        revision.serverNow,
      );
      if (receipt) {
        if (receipt.kind !== "theme-created" || receipt.operation !== "create") {
          throw new Error("Theme create receipt has an unexpected result kind.");
        }
        themeId = receipt.themeId;
        handle = await replayableReceiptHandleInTransaction(
          tx,
          revision,
          accountId,
          input.holderToken,
          receipt.handle,
        );
        return;
      }
      await assertRootAvailable(tx, accountId, revision);
      await assertSourceStillCurrent(tx, accountId, input.source);
      const themeCount = await tx.$count(appearanceThemes, eq(appearanceThemes.accountId, accountId));
      assertDemoCapacity("themes", themeCount);
      themeId = crypto.randomUUID();
      await tx.insert(appearanceThemes).values({
        id: themeId,
        accountId,
        name: input.name,
        declaredScheme: input.declaredScheme,
        contractVersion: validation.payload.tokenContractVersion,
        tokens: validation.payload.tokens,
        validationCanvasColor: validation.payload.validationCanvas.color,
        browserValidation: validation.payload.browserValidation,
        themeRevision: 1n,
      });
      handle = await createThemeLeaseRow(
        tx,
        accountId,
        themeId,
        input.holderToken,
        revision,
        input.keepLease,
      );
      const revisions = await bumpAppearanceRevision(tx, accountId, true);
      await writeMutationReceipt(
        tx,
        accountId,
        input.operationId,
        "theme.create",
        digestValue,
        "theme",
        themeId,
        {
          kind: "theme-created",
          operation: "create",
          themeId,
          handle,
          themeRevision: "1",
          stateRevision: revisions.stateRevision.toString(),
          publishedRevision: revisions.publishedRevision.toString(),
        },
        revision.serverNow,
      );
    });
  } catch (error) {
    mapThemeWriteError(error);
  }

  if (!themeId) throw new Error("Theme creation receipt did not include a theme id.");
  const detail = await getAppearanceTheme(accountId, themeId);
  logger.info({ event: "appearance.theme.saved", userId: accountId, themeId, operationId: input.operationId });
  return { theme: detail.theme, handle, snapshot: await getAppearanceSnapshot(accountId) };
}

async function autosaveReceiptResult(
  accountId: string,
  receipt: NonNullable<Awaited<ReturnType<typeof replayMutationReceipt>>>,
  themeId: string,
) {
  if (receipt.kind !== "formal-saved" && receipt.kind !== "draft-saved") {
    throw new Error("Theme autosave receipt has an unexpected result kind.");
  }
  if (receipt.themeId !== themeId) {
    throw new Error("Theme autosave receipt targets an unexpected resource.");
  }
  return {
    kind: "operation-completed" as const,
    outcome: receipt.kind,
    themeId,
    themeRevision: receipt.kind === "formal-saved" ? receipt.themeRevision : null,
    draftRevision: receipt.kind === "draft-saved" ? receipt.draftRevision : null,
    stateRevision: receipt.stateRevision,
    publishedRevision: receipt.publishedRevision,
    diagnostics: receipt.kind === "draft-saved" ? receipt.diagnostics : [],
    snapshot: receipt.kind === "formal-saved" ? await getAppearanceSnapshot(accountId) : null,
  };
}

export async function autosaveAppearanceTheme(accountId: string, themeId: string, rawInput: unknown) {
  const input = autosaveThemeInputSchema.parse(rawInput);
  const digestValue = requestDigest({
    themeId,
    expectedThemeRevision: input.expectedThemeRevision,
    expectedDraftRevision: input.expectedDraftRevision,
    snapshot: input.snapshot,
  });
  const earlyReceipt = await replayMutationReceipt(
    accountId,
    input.operationId,
    "theme.autosave",
    digestValue,
  );
  if (earlyReceipt) return autosaveReceiptResult(accountId, earlyReceipt, themeId);

  const loose = validateLooseThemeSnapshot(input.snapshot);
  if (!loose.success) {
    throw new AppError({
      code: "APPEARANCE_VALIDATION_FAILED",
      message: "编辑快照超过安全技术边界。",
      status: 422,
      details: { diagnostics: loose.diagnostics },
    });
  }
  if (input.handle.resource.kind !== "theme" || input.handle.resource.themeId !== themeId) {
    throw new AppError({ code: "APPEARANCE_LEASE_LOST", message: "主题租约与目标不匹配。", status: 409 });
  }

  let resultKind: "formal-saved" | "draft-saved" = "draft-saved";
  let diagnostics: AppearanceDiagnostic[] = [];
  let resultRevisions = { stateRevision: "0", publishedRevision: "0" };
  let draftRevision = "0";
  let replayedReceipt: NonNullable<Awaited<ReturnType<typeof replayMutationReceipt>>> | null = null;

  await withAppearanceLeases(
    accountId,
    input.holderToken,
    [input.handle],
    {
      receipt: {
        operationId: input.operationId,
        operationKind: "theme.autosave",
        digestValue,
      },
    },
    async (tx, revision, _rows, receipt) => {
      if (receipt) {
        replayedReceipt = receipt;
        return;
      }

      const [theme] = await tx
        .select()
        .from(appearanceThemes)
        .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)))
        .limit(1)
        .for("update");
      if (!theme) throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "主题不存在。", status: 404 });
      if (theme.themeRevision.toString() !== input.expectedThemeRevision) {
        throw new AppError({ code: "APPEARANCE_RECONFIRM_REQUIRED", message: "主题已被更新，请重新加载。", status: 409 });
      }

      const [existingDraft] = await tx
        .select()
        .from(appearanceThemeDrafts)
        .where(and(eq(appearanceThemeDrafts.accountId, accountId), eq(appearanceThemeDrafts.themeId, themeId)))
        .limit(1)
        .for("update");
      const actualDraftRevision = existingDraft?.draftRevision.toString() ?? null;
      if (actualDraftRevision !== input.expectedDraftRevision) {
        throw new AppError({ code: "APPEARANCE_RECONFIRM_REQUIRED", message: "草稿已变化，请重新加载。", status: 409 });
      }

      if (theme.declaredScheme !== "light" && theme.declaredScheme !== "dark") {
        throw new Error("Stored appearance theme has an invalid declared scheme.");
      }
      const strict = validateFormalTheme({
        tokenContractVersion: TOKEN_CONTRACT_VERSION,
        tokens: input.snapshot.tokens,
        validationCanvas: input.snapshot.validationCanvas,
        browserValidation: input.snapshot.browserValidation,
      }, theme.declaredScheme);
      if (strict.success) {
        resultKind = "formal-saved";
        diagnostics = [];
        const nextThemeRevision = theme.themeRevision + 1n;
        await tx
          .update(appearanceThemes)
          .set({
            contractVersion: strict.payload.tokenContractVersion,
            tokens: strict.payload.tokens,
            validationCanvasColor: strict.payload.validationCanvas.color,
            browserValidation: strict.payload.browserValidation,
            themeRevision: nextThemeRevision,
            updatedAt: revision.serverNow,
          })
          .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)));
        await tx
          .delete(appearanceThemeDrafts)
          .where(and(eq(appearanceThemeDrafts.accountId, accountId), eq(appearanceThemeDrafts.themeId, themeId)));
        const revisions = await bumpAppearanceRevision(tx, accountId, true);
        resultRevisions = {
          stateRevision: revisions.stateRevision.toString(),
          publishedRevision: revisions.publishedRevision.toString(),
        };
        await writeMutationReceipt(
          tx,
          accountId,
          input.operationId,
          "theme.autosave",
          digestValue,
          "theme",
          themeId,
          {
            kind: "formal-saved",
            themeId,
            themeRevision: nextThemeRevision.toString(),
            ...resultRevisions,
          },
          revision.serverNow,
        );
      } else {
        resultKind = "draft-saved";
        diagnostics = strict.diagnostics;
        const nextDraftRevision = (existingDraft?.draftRevision ?? 0n) + 1n;
        draftRevision = nextDraftRevision.toString();
        await tx
          .insert(appearanceThemeDrafts)
          .values({
            accountId,
            themeId,
            contractVersion: DRAFT_CONTRACT_VERSION,
            payload: loose.payload,
            baseThemeRevision: theme.themeRevision,
            draftRevision: nextDraftRevision,
            updatedAt: revision.serverNow,
          })
          .onConflictDoUpdate({
            target: [appearanceThemeDrafts.accountId, appearanceThemeDrafts.themeId],
            set: {
              contractVersion: DRAFT_CONTRACT_VERSION,
              payload: loose.payload,
              baseThemeRevision: theme.themeRevision,
              draftRevision: nextDraftRevision,
              updatedAt: revision.serverNow,
            },
          });
        const revisions = await bumpAppearanceRevision(tx, accountId, false);
        resultRevisions = {
          stateRevision: revisions.stateRevision.toString(),
          publishedRevision: revisions.publishedRevision.toString(),
        };
        await writeMutationReceipt(
          tx,
          accountId,
          input.operationId,
          "theme.autosave",
          digestValue,
          "theme",
          themeId,
          {
            kind: "draft-saved",
            themeId,
            draftRevision,
            diagnostics,
            ...resultRevisions,
          },
          revision.serverNow,
        );
      }
    },
  );

  if (replayedReceipt) return autosaveReceiptResult(accountId, replayedReceipt, themeId);
  const detail = await getAppearanceTheme(accountId, themeId);
  if (String(resultKind) === "formal-saved") {
    logger.info({ event: "appearance.theme.saved", userId: accountId, themeId, operationId: input.operationId });
    return {
      kind: "formal-saved" as const,
      theme: detail.theme,
      snapshot: await getAppearanceSnapshot(accountId),
      stateRevision: resultRevisions.stateRevision,
      publishedRevision: resultRevisions.publishedRevision,
    };
  }
  logger.info({ event: "appearance.draft.saved", userId: accountId, themeId, operationId: input.operationId });
  return {
    kind: "draft-saved" as const,
    draftRevision: detail.draft?.draftRevision ?? draftRevision,
    stateRevision: resultRevisions.stateRevision,
    diagnostics,
  };
}

export async function resolveAppearanceDraft(accountId: string, themeId: string, rawInput: unknown) {
  const input = resolveDraftInputSchema.parse(rawInput);
  const digestValue = requestDigest({ themeId, resolution: input.resolution });
  const replay = await replayMutationReceipt(accountId, input.operationId, "theme.draft.resolve", digestValue);
  if (replay) {
    if (replay.kind !== "draft-resolved" || replay.themeId !== themeId) {
      throw new Error("Draft resolution receipt has an unexpected result kind.");
    }
    return replayedDraftResolutionResult(accountId, themeId, replay.stateRevision);
  }
  if (input.handle.resource.kind !== "theme" || input.handle.resource.themeId !== themeId) {
    throw new AppError({ code: "APPEARANCE_LEASE_LOST", message: "主题租约与目标不匹配。", status: 409 });
  }
  let stateRevision = "0";
  await withAppearanceLeases(
    accountId,
    input.holderToken,
    [input.handle],
    {
      allowDraftResolution: true,
      receipt: {
        operationId: input.operationId,
        operationKind: "theme.draft.resolve",
        digestValue,
      },
    },
    async (tx, revision, rows, receipt) => {
      if (receipt) {
        if (receipt.kind !== "draft-resolved" || receipt.themeId !== themeId) {
          throw new Error("Draft resolution receipt has an unexpected result kind.");
        }
        stateRevision = receipt.stateRevision;
        return;
      }
      const [row] = rows;
      if (!row || row.resourceKind !== "theme") throw new Error("Theme lease row is missing.");
      let revisions = {
        stateRevision: revision.stateRevision,
        publishedRevision: revision.publishedRevision,
      };
      if (input.resolution === "discard") {
        await tx
          .delete(appearanceThemeDrafts)
          .where(and(eq(appearanceThemeDrafts.accountId, accountId), eq(appearanceThemeDrafts.themeId, themeId)));
        revisions = await bumpAppearanceRevision(tx, accountId, false);
      }
      stateRevision = revisions.stateRevision.toString();
      await tx
        .update(appearanceLeases)
        .set({ requiresDraftResolution: false })
        .where(eq(appearanceLeases.rowId, row.rowId));
      const [draft] = await tx
        .select({ draftRevision: appearanceThemeDrafts.draftRevision })
        .from(appearanceThemeDrafts)
        .where(and(eq(appearanceThemeDrafts.accountId, accountId), eq(appearanceThemeDrafts.themeId, themeId)))
        .limit(1);
      await writeMutationReceipt(
        tx,
        accountId,
        input.operationId,
        "theme.draft.resolve",
        digestValue,
        "theme",
        themeId,
        {
          kind: "draft-resolved",
          themeId,
          resolution: input.resolution,
          draftRevision: draft?.draftRevision.toString() ?? null,
          stateRevision,
          publishedRevision: revisions.publishedRevision.toString(),
        },
        revision.serverNow,
      );
    },
  );
  return replayedDraftResolutionResult(accountId, themeId, stateRevision);
}

export async function resetAppearanceTheme(accountId: string, themeId: string, rawInput: unknown) {
  const input = resetThemeInputSchema.parse(rawInput);
  const digestValue = requestDigest({
    themeId,
    expectedThemeRevision: input.expectedThemeRevision,
    source: input.source,
    validationCanvas: input.validationCanvas,
    browserValidation: input.browserValidation,
  });
  const replay = await replayMutationReceipt(accountId, input.operationId, "theme.reset", digestValue);
  if (replay) {
    if (replay.kind !== "theme-mutated" || replay.operation !== "reset" || replay.themeId !== themeId) {
      throw new Error("Theme reset receipt has an unexpected result kind.");
    }
    return replayedThemeMutationResult(accountId, themeId);
  }

  const tokens = await readSourceTokens(accountId, input.source);
  if (input.handle.resource.kind !== "theme" || input.handle.resource.themeId !== themeId) {
    throw new AppError({ code: "APPEARANCE_LEASE_LOST", message: "主题租约与目标不匹配。", status: 409 });
  }
  const current = await getFormalTheme(accountId, themeId);
  const payload = formalPayload(tokens, input.validationCanvas, input.browserValidation);
  const validation = validateFormalTheme(payload, current.declaredScheme);
  if (!validation.success) throw strictValidationError(validation.diagnostics);
  await withAppearanceLeases(
    accountId,
    input.holderToken,
    [input.handle],
    {
      receipt: {
        operationId: input.operationId,
        operationKind: "theme.reset",
        digestValue,
      },
    },
    async (tx, revision, _rows, receipt) => {
      if (receipt) {
        if (receipt.kind !== "theme-mutated" || receipt.operation !== "reset" || receipt.themeId !== themeId) {
          throw new Error("Theme reset receipt has an unexpected result kind.");
        }
        return;
      }
    await assertSourceStillCurrent(tx, accountId, input.source);
    const [theme] = await tx
      .select()
      .from(appearanceThemes)
      .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)))
      .limit(1)
      .for("update");
    if (!theme) throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "主题不存在。", status: 404 });
    if (theme.themeRevision.toString() !== input.expectedThemeRevision) {
      throw new AppError({ code: "APPEARANCE_RECONFIRM_REQUIRED", message: "主题已变化，请重新确认。", status: 409 });
    }
    const nextThemeRevision = theme.themeRevision + 1n;
    await tx
      .update(appearanceThemes)
      .set({
        contractVersion: validation.payload.tokenContractVersion,
        tokens: validation.payload.tokens,
        validationCanvasColor: validation.payload.validationCanvas.color,
        browserValidation: validation.payload.browserValidation,
        themeRevision: nextThemeRevision,
        updatedAt: revision.serverNow,
      })
      .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)));
    await tx
      .delete(appearanceThemeDrafts)
      .where(and(eq(appearanceThemeDrafts.accountId, accountId), eq(appearanceThemeDrafts.themeId, themeId)));
    const revisions = await bumpAppearanceRevision(tx, accountId, true);
      await writeMutationReceipt(
        tx,
        accountId,
        input.operationId,
        "theme.reset",
        digestValue,
        "theme",
        themeId,
        {
          kind: "theme-mutated",
          operation: "reset",
          themeId,
          themeRevision: nextThemeRevision.toString(),
          stateRevision: revisions.stateRevision.toString(),
          publishedRevision: revisions.publishedRevision.toString(),
        },
        revision.serverNow,
      );
    },
  );
  return replayedThemeMutationResult(accountId, themeId);
}

export async function mutateAppearanceConfig(accountId: string, rawInput: unknown) {
  const input = configMutationInputSchema.parse(rawInput);
  const digestValue = requestDigest({ ...input, holderToken: undefined });
  await withAppearanceGate(accountId, async (tx, revision) => {
    const receipt = await readMutationReceipt(
      tx,
      accountId,
      input.operationId,
      "config.update",
      digestValue,
      revision.serverNow,
    );
    if (receipt) {
      if (receipt.kind !== "config-updated") throw new Error("Config receipt has an unexpected result kind.");
      return;
    }
    const lease = await claimOneShotConfigLease(tx, accountId, input.holderToken, revision);
    const [config] = await tx
      .select()
      .from(appearanceConfigs)
      .where(eq(appearanceConfigs.accountId, accountId))
      .limit(1)
      .for("update");
    if (!config) throw new Error("Appearance config row is missing.");

    const patch: Partial<typeof appearanceConfigs.$inferInsert> = {};
    if (input.action === "set-mode") patch.mode = input.mode;
    if (input.action === "set-recovery") {
      patch.recoveryShortcut = input.recoveryShortcut;
      patch.escapeRecoveryEnabled = input.escapeRecoveryEnabled;
    }
    if (input.action === "set-slot") {
      const themeId = selectorToId(input.selector);
      if (themeId) await assertThemeScheme(tx, accountId, themeId, input.scheme);
      if (input.scheme === "light") patch.lightThemeId = themeId;
      else patch.darkThemeId = themeId;
    }
    if (input.action === "apply-theme") {
      const scheme = await getThemeScheme(tx, accountId, input.themeId);
      patch.mode = scheme;
      if (scheme === "light") patch.lightThemeId = input.themeId;
      else patch.darkThemeId = input.themeId;
    }

    await tx
      .update(appearanceConfigs)
      .set({ ...patch, updatedAt: revision.serverNow })
      .where(eq(appearanceConfigs.accountId, accountId));
    const revisions = await bumpAppearanceRevision(tx, accountId, true);
    await writeMutationReceipt(
      tx,
      accountId,
      input.operationId,
      "config.update",
      digestValue,
      "config",
      null,
      {
        kind: "config-updated",
        stateRevision: revisions.stateRevision.toString(),
        publishedRevision: revisions.publishedRevision.toString(),
      },
      revision.serverNow,
    );
    await releaseOneShotLease(tx, lease.rowId, revision.serverNow);
  });
  return { snapshot: await getAppearanceSnapshot(accountId) };
}

async function getThemeScheme(
  tx: Parameters<Parameters<ReturnType<typeof import("@/lib/db/client").getDb>["transaction"]>[0]>[0],
  accountId: string,
  themeId: string,
): Promise<DeclaredScheme> {
  const [theme] = await tx
    .select({ declaredScheme: appearanceThemes.declaredScheme })
    .from(appearanceThemes)
    .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)))
    .limit(1)
    .for("share");
  if (!theme) throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "主题不存在。", status: 404 });
  if (theme.declaredScheme !== "light" && theme.declaredScheme !== "dark") throw new Error("Invalid theme scheme.");
  return theme.declaredScheme;
}

async function assertThemeScheme(
  tx: Parameters<Parameters<ReturnType<typeof import("@/lib/db/client").getDb>["transaction"]>[0]>[0],
  accountId: string,
  themeId: string,
  scheme: DeclaredScheme,
): Promise<void> {
  if ((await getThemeScheme(tx, accountId, themeId)) !== scheme) {
    throw new AppError({
      code: "APPEARANCE_VALIDATION_FAILED",
      message: "槽位只能选择声明类型相同的主题。",
      status: 422,
    });
  }
}

function impactDigest(value: unknown): string {
  return requestDigest(value);
}

async function buildImpact(
  accountId: string,
  themeId: string,
  action: "delete" | "change-scheme",
  options?: { newScheme?: DeclaredScheme; resolvedSystemScheme?: DeclaredScheme; canvas?: string },
) {
  const snapshot = await getAppearanceSnapshot(accountId);
  const theme = await getFormalTheme(accountId, themeId);
  const configState = {
    mode: snapshot.config.mode,
    lightThemeId: selectorToId(snapshot.config.lightTheme),
    darkThemeId: selectorToId(snapshot.config.darkTheme),
  };
  const oldScheme = theme.declaredScheme;

  if (action === "change-scheme") {
    if (!options?.newScheme || !options.resolvedSystemScheme || !options.canvas) {
      throw new Error("Theme scheme impact is missing confirmation context.");
    }
    if (oldScheme === options.newScheme) {
      throw new AppError({
        code: "APPEARANCE_VALIDATION_FAILED",
        message: "新的主题类型必须与当前类型不同。",
        status: 422,
      });
    }
    const transition = deriveThemeSchemeTransition({
      themeId,
      stateRevision: snapshot.stateRevision,
      oldScheme,
      newScheme: options.newScheme,
      config: configState,
      resolvedSystemSchemeAtConfirmation: options.resolvedSystemScheme,
      validationCanvasColor: options.canvas,
    });
    return {
      action,
      themeId,
      stateRevision: snapshot.stateRevision,
      affectedSlots: transition.affectedSlots,
      currentlyActive: transition.currentlyActive,
      displacedThemeId: transition.displacedThemeId,
      impactDigest: impactDigest(transition.impactPayload),
    };
  }

  const affectedSlots = (["light", "dark"] as const).filter(
    (scheme) => (scheme === "light" ? configState.lightThemeId : configState.darkThemeId) === themeId,
  );
  const currentlyActive =
    configState.mode === oldScheme && affectedSlots.includes(oldScheme);
  const base = {
    action,
    themeId,
    stateRevision: snapshot.stateRevision,
    oldScheme,
    newScheme: null,
    slots: snapshot.config,
    resolvedSystemScheme: null,
    canvas: null,
  };
  return {
    action,
    themeId,
    stateRevision: snapshot.stateRevision,
    affectedSlots,
    currentlyActive,
    displacedThemeId: null,
    impactDigest: impactDigest(base),
  };
}

export function previewDeleteAppearanceTheme(accountId: string, themeId: string) {
  return buildImpact(accountId, themeId, "delete");
}

export function previewChangeAppearanceThemeScheme(
  accountId: string,
  themeId: string,
  newScheme: DeclaredScheme,
  resolvedSystemScheme: DeclaredScheme,
  canvas: string,
) {
  return buildImpact(accountId, themeId, "change-scheme", { newScheme, resolvedSystemScheme, canvas });
}

export async function mutateAppearanceTheme(accountId: string, themeId: string, rawInput: unknown) {
  const input = themeMutationInputSchema.parse(rawInput);
  const operationKind = input.action === "rename" ? "theme.rename" : "theme.change-scheme";
  const digestValue = requestDigest(
    input.action === "rename"
      ? {
          themeId,
          action: input.action,
          expectedStateRevision: input.expectedStateRevision,
          name: input.name,
        }
      : {
          themeId,
          action: input.action,
          expectedStateRevision: input.expectedStateRevision,
          declaredScheme: input.declaredScheme,
          resolvedSystemSchemeAtConfirmation: input.resolvedSystemSchemeAtConfirmation,
          validationCanvas: input.validationCanvas,
          browserValidation: input.browserValidation,
          impactDigest: input.impactDigest,
        },
  );
  const replay = await replayMutationReceipt(accountId, input.operationId, operationKind, digestValue);
  if (replay) {
    const expectedOperation = input.action === "rename" ? "rename" : "change-scheme";
    if (
      replay.kind !== "theme-mutated" ||
      replay.operation !== expectedOperation ||
      replay.themeId !== themeId
    ) {
      throw new Error("Theme mutation receipt has an unexpected result kind.");
    }
    return replayedThemeMutationResult(accountId, themeId);
  }

  if (input.action === "rename") {
    assertThemeMutationHandles(input.handles, themeId, false);
    try {
      await withAppearanceLeases(
        accountId,
        input.holderToken,
        input.handles,
        {
          receipt: {
            operationId: input.operationId,
            operationKind,
            digestValue,
          },
        },
        async (tx, revision, _rows, receipt) => {
          if (receipt) {
            if (receipt.kind !== "theme-mutated" || receipt.operation !== "rename" || receipt.themeId !== themeId) {
              throw new Error("Theme rename receipt has an unexpected result kind.");
            }
            return;
          }
        if (revision.stateRevision.toString() !== input.expectedStateRevision) {
          throw new AppError({ code: "APPEARANCE_RECONFIRM_REQUIRED", message: "外观状态已变化。", status: 409 });
        }
        const [theme] = await tx
          .select({ themeRevision: appearanceThemes.themeRevision })
          .from(appearanceThemes)
          .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)))
          .limit(1)
          .for("update");
        if (!theme) throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "主题不存在。", status: 404 });
        const nextThemeRevision = theme.themeRevision + 1n;
        await tx
          .update(appearanceThemes)
          .set({ name: input.name, themeRevision: nextThemeRevision, updatedAt: revision.serverNow })
          .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)));
        const revisions = await bumpAppearanceRevision(tx, accountId, true);
          await writeMutationReceipt(
            tx,
            accountId,
            input.operationId,
            operationKind,
            digestValue,
            "theme",
            themeId,
            {
              kind: "theme-mutated",
              operation: "rename",
              themeId,
              themeRevision: nextThemeRevision.toString(),
              stateRevision: revisions.stateRevision.toString(),
              publishedRevision: revisions.publishedRevision.toString(),
            },
            revision.serverNow,
          );
        },
      );
    } catch (error) {
      mapThemeWriteError(error);
    }
    return replayedThemeMutationResult(accountId, themeId);
  }

  assertThemeMutationHandles(input.handles, themeId, true);
  const current = await getFormalTheme(accountId, themeId);
  const payload = formalPayload(current.tokens, input.validationCanvas, input.browserValidation);
  const validation = validateFormalTheme(payload, input.declaredScheme);
  if (!validation.success) throw strictValidationError(validation.diagnostics);
  await withAppearanceLeases(
    accountId,
    input.holderToken,
    input.handles,
    {
      receipt: {
        operationId: input.operationId,
        operationKind,
        digestValue,
      },
    },
    async (tx, revision, _rows, receipt) => {
      if (receipt) {
        if (receipt.kind !== "theme-mutated" || receipt.operation !== "change-scheme" || receipt.themeId !== themeId) {
          throw new Error("Theme type-change receipt has an unexpected result kind.");
        }
        return;
      }
    if (revision.stateRevision.toString() !== input.expectedStateRevision) {
      throw new AppError({ code: "APPEARANCE_RECONFIRM_REQUIRED", message: "外观状态已变化。", status: 409 });
    }
    const [config] = await tx
      .select()
      .from(appearanceConfigs)
      .where(eq(appearanceConfigs.accountId, accountId))
      .limit(1)
      .for("update");
    const [theme] = await tx
      .select()
      .from(appearanceThemes)
      .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)))
      .limit(1)
      .for("update");
    if (!config || !theme) throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "主题不存在。", status: 404 });
    if (theme.declaredScheme !== "light" && theme.declaredScheme !== "dark") {
      throw new Error("Stored theme has an invalid declared scheme.");
    }
    const oldScheme = theme.declaredScheme;
    if (oldScheme === input.declaredScheme) {
      throw new AppError({
        code: "APPEARANCE_VALIDATION_FAILED",
        message: "新的主题类型必须与当前类型不同。",
        status: 422,
      });
    }
    if (config.mode !== "light" && config.mode !== "dark" && config.mode !== "system") {
      throw new Error("Stored appearance config has an invalid mode.");
    }
    const transition = deriveThemeSchemeTransition({
      themeId,
      stateRevision: revision.stateRevision.toString(),
      oldScheme,
      newScheme: input.declaredScheme,
      config: {
        mode: config.mode,
        lightThemeId: config.lightThemeId,
        darkThemeId: config.darkThemeId,
      },
      resolvedSystemSchemeAtConfirmation: input.resolvedSystemSchemeAtConfirmation,
      validationCanvasColor: input.validationCanvas.color,
    });
    if (impactDigest(transition.impactPayload) !== input.impactDigest) {
      throw new AppError({
        code: "APPEARANCE_RECONFIRM_REQUIRED",
        message: "主题类型变更摘要已失效。",
        status: 409,
      });
    }
    const nextThemeRevision = theme.themeRevision + 1n;
    await tx
      .update(appearanceThemes)
      .set({
        declaredScheme: input.declaredScheme,
        validationCanvasColor: validation.payload.validationCanvas.color,
        browserValidation: validation.payload.browserValidation,
        themeRevision: nextThemeRevision,
        updatedAt: revision.serverNow,
      })
      .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)));
    await tx
      .update(appearanceConfigs)
      .set({
        mode: transition.nextConfig.mode,
        lightThemeId: transition.nextConfig.lightThemeId,
        darkThemeId: transition.nextConfig.darkThemeId,
        updatedAt: revision.serverNow,
      })
      .where(eq(appearanceConfigs.accountId, accountId));
    const revisions = await bumpAppearanceRevision(tx, accountId, true);
      await writeMutationReceipt(
        tx,
        accountId,
        input.operationId,
        operationKind,
        digestValue,
        "theme",
        themeId,
        {
          kind: "theme-mutated",
          operation: "change-scheme",
          themeId,
          themeRevision: nextThemeRevision.toString(),
          stateRevision: revisions.stateRevision.toString(),
          publishedRevision: revisions.publishedRevision.toString(),
        },
        revision.serverNow,
      );
    },
  );
  return replayedThemeMutationResult(accountId, themeId);
}

export async function deleteAppearanceTheme(accountId: string, themeId: string, rawInput: unknown) {
  const input = deleteThemeInputSchema.parse(rawInput);
  const digestValue = requestDigest({
    themeId,
    expectedStateRevision: input.expectedStateRevision,
    impactDigest: input.impactDigest,
    discardDraft: input.discardDraft,
  });
  const replay = await replayMutationReceipt(accountId, input.operationId, "theme.delete", digestValue);
  if (replay) {
    if (replay.kind !== "theme-deleted" || replay.themeId !== themeId) {
      throw new Error("Theme delete receipt has an unexpected result kind.");
    }
    return { deleted: true, snapshot: await getAppearanceSnapshot(accountId) };
  }

  assertThemeMutationHandles(input.handles, themeId, true);
  const expectedImpact = await previewDeleteAppearanceTheme(accountId, themeId);
  if (expectedImpact.impactDigest !== input.impactDigest || expectedImpact.stateRevision !== input.expectedStateRevision) {
    throw new AppError({ code: "APPEARANCE_RECONFIRM_REQUIRED", message: "删除影响摘要已失效。", status: 409 });
  }
  await withAppearanceLeases(
    accountId,
    input.holderToken,
    input.handles,
    {
      allowDraftResolution: input.discardDraft,
      receipt: {
        operationId: input.operationId,
        operationKind: "theme.delete",
        digestValue,
      },
    },
    async (tx, revision, leaseRows, receipt) => {
      if (receipt) {
        if (receipt.kind !== "theme-deleted" || receipt.themeId !== themeId) {
          throw new Error("Theme delete receipt has an unexpected result kind.");
        }
        return;
      }
    if (revision.stateRevision.toString() !== input.expectedStateRevision) {
      throw new AppError({ code: "APPEARANCE_RECONFIRM_REQUIRED", message: "外观状态已变化。", status: 409 });
    }
    const [config] = await tx
      .select()
      .from(appearanceConfigs)
      .where(eq(appearanceConfigs.accountId, accountId))
      .limit(1)
      .for("update");
    if (!config) throw new Error("Appearance config row is missing.");
    await tx
      .update(appearanceConfigs)
      .set({
        ...(config.lightThemeId === themeId ? { lightThemeId: null } : {}),
        ...(config.darkThemeId === themeId ? { darkThemeId: null } : {}),
        updatedAt: revision.serverNow,
      })
      .where(eq(appearanceConfigs.accountId, accountId));
    const configLease = leaseRows.find((row) => row.resourceKind === "config");
    if (!configLease) throw new Error("Validated delete operation is missing the config lease row.");
    await releaseOneShotLease(tx, configLease.rowId, revision.serverNow);
    await tx
      .delete(appearanceThemes)
      .where(and(eq(appearanceThemes.accountId, accountId), eq(appearanceThemes.id, themeId)));
    const revisions = await bumpAppearanceRevision(tx, accountId, true);
      await writeMutationReceipt(
        tx,
        accountId,
        input.operationId,
        "theme.delete",
        digestValue,
        "theme",
        themeId,
        {
          kind: "theme-deleted",
          themeId,
          stateRevision: revisions.stateRevision.toString(),
          publishedRevision: revisions.publishedRevision.toString(),
        },
        revision.serverNow,
      );
    },
  );
  return { deleted: true, snapshot: await getAppearanceSnapshot(accountId) };
}

export async function safetyRecoverAppearance(accountId: string, rawInput: unknown) {
  const input = recoveryInputSchema.parse(rawInput);
  const digestValue = requestDigest(input);
  await withAppearanceGate(accountId, async (tx, revision) => {
    const receipt = await readMutationReceipt(
      tx,
      accountId,
      input.operationId,
      "appearance.recovery",
      digestValue,
      revision.serverNow,
    );
    if (receipt) {
      if (receipt.kind !== "appearance-recovered") throw new Error("Recovery receipt has an unexpected result kind.");
      return;
    }
    await tx
      .update(appearanceConfigs)
      .set({ mode: "system", lightThemeId: null, darkThemeId: null, updatedAt: revision.serverNow })
      .where(eq(appearanceConfigs.accountId, accountId));
    const [revisions] = await tx
      .update(appearanceLockState)
      .set({
        lockEpoch: sql`${appearanceLockState.lockEpoch} + 1`,
        stateRevision: sql`${appearanceLockState.stateRevision} + 1`,
        publishedRevision: sql`${appearanceLockState.publishedRevision} + 1`,
        updatedAt: revision.serverNow,
      })
      .where(eq(appearanceLockState.accountId, accountId))
      .returning({
        stateRevision: appearanceLockState.stateRevision,
        publishedRevision: appearanceLockState.publishedRevision,
      });
    if (!revisions) throw new Error("Appearance recovery revision update failed.");
    await writeMutationReceipt(
      tx,
      accountId,
      input.operationId,
      "appearance.recovery",
      digestValue,
      "root",
      null,
      {
        kind: "appearance-recovered",
        stateRevision: revisions.stateRevision.toString(),
        publishedRevision: revisions.publishedRevision.toString(),
      },
      revision.serverNow,
    );
  });
  logger.info({ event: "appearance.recovery.completed", userId: accountId, operationId: input.operationId });
  return { snapshot: await getAppearanceSnapshot(accountId) };
}
