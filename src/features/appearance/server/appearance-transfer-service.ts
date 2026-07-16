import "server-only";

import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import {
  appearanceConfigs,
  appearanceLeases,
  appearanceLockState,
  appearanceRestorePlans,
  appearanceThemeDrafts,
  appearanceThemes,
} from "@/db/schema";
import {
  appearancePackageV1Schema,
  importThemeInputSchema,
  packageThemeV1Schema,
  restoreConfirmInputSchema,
  restorePreviewInputSchema,
  restoreSummarySchema,
  themeFileV1Schema,
  type AppearancePackageV1,
} from "@/features/appearance/schemas/appearance-schema";
import {
  APPEARANCE_PACKAGE_VERSION,
  THEME_FILE_VERSION,
  type BrowserValidationReportV1,
  type DeclaredScheme,
  type FormalThemePayloadV1,
  type PortableThemeV1,
} from "@/features/appearance/theme-contract";
import { decodeAppearanceConfig, decodeStoredTheme } from "@/features/appearance/server/appearance-codec";
import {
  assertRootAvailable,
  bumpAppearanceRevision,
  createThemeLeaseRow,
  ensureAppearanceAccount,
  readMutationReceipt,
  replayMutationReceipt,
  replayableReceiptHandle,
  replayableReceiptHandleInTransaction,
  requestDigest,
  type AppearanceTransaction,
  withAppearanceGate,
  withAppearanceLeases,
  writeMutationReceipt,
} from "@/features/appearance/server/appearance-db";
import { validateFormalTheme } from "@/features/appearance/server/color-validation";
import { getAppearanceSnapshot, getAppearanceTheme } from "@/features/appearance/server/appearance-query-service";
import {
  browserValidationImportExpansionBytes,
  projectedPackageImportRequestBytes,
  projectedThemeImportRequestBytes,
} from "@/features/appearance/server/portable-size";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { assertDemoCapacity, assertDemoReplacementCount } from "@/lib/config/demo-policy";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";

function throwFormalDiagnostics(diagnostics: ReturnType<typeof validateFormalTheme> extends infer Result
  ? Result extends { success: false; diagnostics: infer Diagnostics }
    ? Diagnostics
    : never
  : never): never {
  const browserRequired = diagnostics.some(
    (item) => item.code === "BROWSER_VALIDATION_REQUIRED" || item.code === "BROWSER_VALIDATION_MISMATCH",
  );
  throw new AppError({
    code: browserRequired ? "APPEARANCE_BROWSER_VALIDATION_REQUIRED" : "APPEARANCE_VALIDATION_FAILED",
    message: browserRequired ? "当前浏览器无法验证导入文件中的动态颜色。" : "导入主题未通过安全或对比度校验。",
    status: 422,
    details: { diagnostics },
  });
}

function parsePortableImportInput<T>(
  rawInput: unknown,
  parser: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: Error } },
  expectedKind: "fulltext-rss-reader.theme" | "fulltext-rss-reader.appearance-package",
  expectedVersion: number,
): T {
  const parsed = parser.safeParse(rawInput);
  if (parsed.success) return parsed.data;
  const file = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) && "file" in rawInput
    ? Reflect.get(rawInput, "file")
    : undefined;
  const kind = file && typeof file === "object" && !Array.isArray(file) ? Reflect.get(file, "kind") : undefined;
  const version = file && typeof file === "object" && !Array.isArray(file) ? Reflect.get(file, "version") : undefined;
  if (kind !== expectedKind || version !== expectedVersion) {
    throw new AppError({
      code: "APPEARANCE_IMPORT_UNSUPPORTED",
      message: "导入文件的类型或版本不受支持。",
      status: 422,
    });
  }
  throw parsed.error;
}

function validatedPortableTheme(
  theme: PortableThemeV1,
  browserValidation: BrowserValidationReportV1 | null,
): PortableThemeV1 {
  const payload: FormalThemePayloadV1 = {
    tokenContractVersion: theme.tokenContractVersion,
    tokens: theme.tokens,
    validationCanvas: theme.validationCanvas,
    browserValidation,
  };
  const validation = validateFormalTheme(payload, theme.declaredScheme);
  if (!validation.success) throwFormalDiagnostics(validation.diagnostics);
  return {
    name: theme.name,
    declaredScheme: theme.declaredScheme,
    ...validation.payload,
  };
}

async function uniqueImportedName(
  tx: AppearanceTransaction,
  accountId: string,
  requestedName: string,
): Promise<string> {
  // The account gate serializes imports. PostgreSQL lower() is also the unique
  // index authority, and the recursive probe avoids loading an unbounded list.
  const rows = await tx.execute<{ name: string }>(sql`
    with recursive candidates(suffix, name) as (
      values (1, ${requestedName}::text)
      union all
      select candidates.suffix + 1, ${requestedName} || ' (' || (candidates.suffix + 1)::text || ')'
      from candidates
      where exists (
        select 1
        from appearance_themes
        where account_id = ${accountId}
          and lower(appearance_themes.name) = lower(candidates.name)
      )
    )
    select candidates.name
    from candidates
    where not exists (
      select 1
      from appearance_themes
      where account_id = ${accountId}
        and lower(appearance_themes.name) = lower(candidates.name)
    )
    order by candidates.suffix
    limit 1
  `);
  const [candidate] = Array.from(rows);
  if (!candidate) throw new Error("Could not allocate an imported theme name.");
  return candidate.name;
}

export async function exportAppearanceTheme(accountId: string, themeId: string) {
  const { theme } = await getAppearanceTheme(accountId, themeId);
  const file = themeFileV1Schema.parse({
    kind: "fulltext-rss-reader.theme",
    version: THEME_FILE_VERSION,
    theme: {
      name: theme.name,
      declaredScheme: theme.declaredScheme,
      tokenContractVersion: theme.tokenContractVersion,
      tokens: theme.tokens,
      validationCanvas: theme.validationCanvas,
      browserValidation: theme.browserValidation,
    },
  });
  if (projectedThemeImportRequestBytes(file) > APPEARANCE_TECHNICAL_LIMITS.themeRequestBytes) {
    throw new AppError({
      code: "PAYLOAD_TOO_LARGE",
      message: "单主题导出及其重新验证请求超过部署技术限制。",
      status: 413,
    });
  }
  return file;
}

export async function importAppearanceTheme(accountId: string, rawInput: unknown) {
  const input = parsePortableImportInput(
    rawInput,
    importThemeInputSchema,
    "fulltext-rss-reader.theme",
    THEME_FILE_VERSION,
  );
  const digestValue = requestDigest({
    file: input.file,
    editAfterImport: input.editAfterImport,
  });
  const replay = await replayMutationReceipt(accountId, input.operationId, "theme.import", digestValue);
  if (replay) {
    if (replay.kind !== "theme-created" || replay.operation !== "import") {
      throw new Error("Theme import receipt has an unexpected result kind.");
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
        operation: "import" as const,
        themeId: replay.themeId,
        themeRevision: replay.themeRevision,
        stateRevision: replay.stateRevision,
        publishedRevision: replay.publishedRevision,
        snapshot,
      };
    }
  }

  const imported = validatedPortableTheme(input.file.theme, input.file.theme.browserValidation);
  let themeId = "";
  let handle = null as Awaited<ReturnType<typeof createThemeLeaseRow>>;

  await withAppearanceGate(accountId, async (tx, revision) => {
      const receipt = await readMutationReceipt(
        tx,
        accountId,
        input.operationId,
        "theme.import",
        digestValue,
        revision.serverNow,
      );
      if (receipt) {
        if (receipt.kind !== "theme-created" || receipt.operation !== "import") {
          throw new Error("Theme import receipt has an unexpected result kind.");
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
      const themeCount = await tx.$count(appearanceThemes, eq(appearanceThemes.accountId, accountId));
      assertDemoCapacity("themes", themeCount);
      const name = await uniqueImportedName(tx, accountId, imported.name);
      themeId = crypto.randomUUID();
      await tx.insert(appearanceThemes).values({
        id: themeId,
        accountId,
        name,
        declaredScheme: imported.declaredScheme,
        contractVersion: imported.tokenContractVersion,
        tokens: imported.tokens,
        validationCanvasColor: imported.validationCanvas.color,
        browserValidation: imported.browserValidation,
        themeRevision: 1n,
      });
      handle = await createThemeLeaseRow(
        tx,
        accountId,
        themeId,
        input.holderToken,
        revision,
        input.editAfterImport,
      );
      const revisions = await bumpAppearanceRevision(tx, accountId, true);
      await writeMutationReceipt(
        tx,
        accountId,
        input.operationId,
        "theme.import",
        digestValue,
        "theme",
        themeId,
        {
          kind: "theme-created",
          operation: "import",
          themeId,
          handle,
          themeRevision: "1",
          stateRevision: revisions.stateRevision.toString(),
          publishedRevision: revisions.publishedRevision.toString(),
        },
        revision.serverNow,
      );
  });

  if (!themeId) throw new Error("Theme import did not produce an id.");
  return { theme: (await getAppearanceTheme(accountId, themeId)).theme, handle, snapshot: await getAppearanceSnapshot(accountId) };
}

type PackageTheme = AppearancePackageV1["themes"][number];

type ExportCursor = {
  id: string;
};

async function visitAppearanceExportThemes(
  tx: AppearanceTransaction,
  accountId: string,
  visit: (theme: PackageTheme) => Promise<void> | void,
  assertAvailable: () => void = () => undefined,
): Promise<Map<string, string>> {
  const portableIdByDatabaseId = new Map<string, string>();
  let cursor: ExportCursor | null = null;
  let position = 0;

  while (true) {
    assertAvailable();
    const rows = await tx
      .select()
      .from(appearanceThemes)
      .where(
        and(
          eq(appearanceThemes.accountId, accountId),
          cursor ? gt(appearanceThemes.id, cursor.id) : undefined,
        ),
      )
      .orderBy(asc(appearanceThemes.id))
      .limit(APPEARANCE_TECHNICAL_LIMITS.listMaximum);
    assertAvailable();

    for (const row of rows) {
      const theme = decodeStoredTheme(row);
      position += 1;
      const portableId = `theme-${position}`;
      portableIdByDatabaseId.set(theme.id, portableId);
      await visit(packageThemeV1Schema.parse({
        portableId,
        name: theme.name,
        declaredScheme: theme.declaredScheme,
        tokenContractVersion: theme.tokenContractVersion,
        tokens: theme.tokens,
        validationCanvas: theme.validationCanvas,
        browserValidation: theme.browserValidation,
      }));
    }

    const last = rows.at(-1);
    if (!last || rows.length < APPEARANCE_TECHNICAL_LIMITS.listMaximum) break;
    cursor = { id: last.id };
  }
  return portableIdByDatabaseId;
}

function portableExportConfig(
  config: typeof appearanceConfigs.$inferSelect,
  portableIdByDatabaseId: Map<string, string>,
): AppearancePackageV1["config"] {
  const decodedConfig = decodeAppearanceConfig(config);
  const toPortableSelector = (selector: typeof decodedConfig.lightTheme | typeof decodedConfig.darkTheme) => {
    if (selector.kind === "builtin") return { kind: "builtin" as const };
    const portableId = portableIdByDatabaseId.get(selector.themeId);
    if (!portableId) throw new Error("Appearance export snapshot contains a dangling slot reference.");
    return { kind: "custom" as const, portableId };
  };
  return {
    mode: decodedConfig.mode,
    lightTheme: toPortableSelector(decodedConfig.lightTheme),
    darkTheme: toPortableSelector(decodedConfig.darkTheme),
    recoveryShortcut: decodedConfig.recoveryShortcut,
    escapeRecoveryEnabled: decodedConfig.escapeRecoveryEnabled,
  };
}

async function selectAppearanceExportConfig(
  tx: AppearanceTransaction,
  accountId: string,
): Promise<typeof appearanceConfigs.$inferSelect> {
  const [config] = await tx
    .select()
    .from(appearanceConfigs)
    .where(eq(appearanceConfigs.accountId, accountId))
    .limit(1);
  if (!config) throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "外观配置不存在。", status: 404 });
  return config;
}

function assertPackageExportSize(byteLength: number, reportExpansionBytes = 0): void {
  if (
    byteLength > APPEARANCE_TECHNICAL_LIMITS.packageRequestBytes ||
    projectedPackageImportRequestBytes(byteLength, reportExpansionBytes) >
      APPEARANCE_TECHNICAL_LIMITS.packageRequestBytes
  ) {
    throw new AppError({
      code: "PAYLOAD_TOO_LARGE",
      message: "账户外观备份及其重新验证请求超过部署技术限制。",
      status: 413,
    });
  }
}

async function configureExportTransaction(tx: AppearanceTransaction): Promise<void> {
  const timeout = APPEARANCE_TECHNICAL_LIMITS.snapshotTimeoutMs;
  await tx.execute(sql.raw(`set local statement_timeout = '${timeout}ms'`));
  await tx.execute(sql.raw(`set local transaction_timeout = '${timeout}ms'`));
  await tx.execute(sql.raw(`set local idle_in_transaction_session_timeout = '${timeout}ms'`));
}

export async function exportAppearancePackage(accountId: string): Promise<AppearancePackageV1> {
  await ensureAppearanceAccount(accountId);
  return getDb().transaction(
    async (tx) => {
      await configureExportTransaction(tx);
      const config = await selectAppearanceExportConfig(tx, accountId);
      const themes: AppearancePackageV1["themes"] = [];
      const portableIds = await visitAppearanceExportThemes(tx, accountId, (theme) => {
        themes.push(theme);
      });
      const file = appearancePackageV1Schema.parse({
        kind: "fulltext-rss-reader.appearance-package",
        version: APPEARANCE_PACKAGE_VERSION,
        config: portableExportConfig(config, portableIds),
        themes,
      });
      assertPackageExportSize(
        Buffer.byteLength(JSON.stringify(file), "utf8"),
        file.themes.reduce(
          (total, theme) => total + browserValidationImportExpansionBytes(theme),
          0,
        ),
      );
      return file;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

function exportUnavailable(message: string, cause?: unknown): AppError {
  return new AppError({
    code: "APPEARANCE_BUSY",
    message,
    status: 503,
    details: { retryable: true },
    cause,
  });
}

export async function prepareAppearancePackageDownload(
  accountId: string,
  signal?: AbortSignal,
): Promise<{ body: ReadableStream<Uint8Array>; contentLength: number }> {
  await ensureAppearanceAccount(accountId);
  const path = join(tmpdir(), `fulltext-rss-reader-appearance-${randomUUID()}.json`);
  const file = await open(path, "wx+", 0o600);
  try {
    // Keep the anonymous descriptor only. Cancellation, process exit, and
    // normal stream close then reclaim the file without a stale pathname.
    await unlink(path);
  } catch (error) {
    await file.close().catch(() => undefined);
    throw error;
  }
  const deadline = Date.now() + APPEARANCE_TECHNICAL_LIMITS.snapshotTimeoutMs;
  let byteLength = 0;
  let reportExpansionBytes = 0;
  let handedOff = false;

  const assertAvailable = () => {
    if (signal?.aborted) throw exportUnavailable("外观备份下载已取消。");
    if (Date.now() > deadline) throw exportUnavailable("外观备份生成超时，请重试。");
  };
  const write = async (text: string) => {
    assertAvailable();
    const chunk = Buffer.from(text, "utf8");
    assertPackageExportSize(byteLength + chunk.byteLength, reportExpansionBytes);
    let offset = 0;
    while (offset < chunk.byteLength) {
      const result = await file.write(chunk, offset, chunk.byteLength - offset, null);
      if (result.bytesWritten === 0) throw new Error("Appearance export temporary file stopped accepting data.");
      offset += result.bytesWritten;
    }
    byteLength += chunk.byteLength;
  };

  try {
    await getDb().transaction(
      async (tx) => {
        await configureExportTransaction(tx);
        const config = await selectAppearanceExportConfig(tx, accountId);
        await write(`{"kind":"fulltext-rss-reader.appearance-package","version":${APPEARANCE_PACKAGE_VERSION},"themes":[`);
        let first = true;
        const portableIds = await visitAppearanceExportThemes(tx, accountId, async (theme) => {
          reportExpansionBytes += browserValidationImportExpansionBytes(theme);
          await write(`${first ? "" : ","}${JSON.stringify(theme)}`);
          first = false;
        }, assertAvailable);
        const validated = appearancePackageV1Schema.parse({
          kind: "fulltext-rss-reader.appearance-package",
          version: APPEARANCE_PACKAGE_VERSION,
          config: portableExportConfig(config, portableIds),
          themes: [],
        });
        await write(`],"config":${JSON.stringify(validated.config)}}`);
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    assertAvailable();

    const nodeStream = file.createReadStream({ start: 0, autoClose: true });
    handedOff = true;
    return {
      body: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
      contentLength: byteLength,
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "57014") throw exportUnavailable("外观备份生成超时，请重试。", error);
    throw error;
  } finally {
    if (!handedOff) await file.close().catch(() => undefined);
  }
}

async function cleanupExpiredRestorePlans(
  tx: AppearanceTransaction,
  accountId: string,
  serverNow: Date,
): Promise<void> {
  await tx
    .delete(appearanceRestorePlans)
    .where(
      and(
        eq(appearanceRestorePlans.accountId, accountId),
        inArray(
          appearanceRestorePlans.planId,
          tx
            .select({ planId: appearanceRestorePlans.planId })
            .from(appearanceRestorePlans)
            .where(
              and(
                eq(appearanceRestorePlans.accountId, accountId),
                lt(appearanceRestorePlans.expiresAt, serverNow),
              ),
            )
            .limit(APPEARANCE_TECHNICAL_LIMITS.cleanupBatch),
        ),
      ),
    );
}

async function assertPackageNamesUniqueForDatabase(
  tx: AppearanceTransaction,
  names: string[],
): Promise<void> {
  if (names.length < 2) return;
  const values = sql.join(names.map((name) => sql`(${name}::text)`), sql`, `);
  const duplicates = await tx.execute<{ normalized_name: string }>(sql`
    select lower(input.name) as normalized_name
    from (values ${values}) as input(name)
    group by lower(input.name)
    having count(*) > 1
    limit 1
  `);
  if (Array.from(duplicates).length > 0) {
    throw new AppError({
      code: "APPEARANCE_NAME_CONFLICT",
      message: "整包包含数据库大小写规则下的重名主题。",
      status: 422,
    });
  }
}

function validatePackageReferences(file: AppearancePackageV1): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  const schemeById = new Map<string, DeclaredScheme>();
  for (const theme of file.themes) {
    if (ids.has(theme.portableId)) {
      throw new AppError({ code: "APPEARANCE_IMPORT_UNSUPPORTED", message: "整包包含重复的可移植主题标识。", status: 422 });
    }
    ids.add(theme.portableId);
    const normalizedName = theme.name.toLocaleLowerCase("und");
    if (names.has(normalizedName)) {
      throw new AppError({ code: "APPEARANCE_NAME_CONFLICT", message: "整包包含大小写不敏感的重名主题。", status: 422 });
    }
    names.add(normalizedName);
    schemeById.set(theme.portableId, theme.declaredScheme);
  }
  for (const [scheme, selector] of [["light", file.config.lightTheme], ["dark", file.config.darkTheme]] as const) {
    if (selector.kind === "custom" && schemeById.get(selector.portableId) !== scheme) {
      throw new AppError({ code: "APPEARANCE_IMPORT_UNSUPPORTED", message: `${scheme === "light" ? "明亮" : "暗色"}槽位引用无效。`, status: 422 });
    }
  }
}

export async function previewAppearanceRestore(accountId: string, rawInput: unknown) {
  const input = parsePortableImportInput(
    rawInput,
    restorePreviewInputSchema,
    "fulltext-rss-reader.appearance-package",
    APPEARANCE_PACKAGE_VERSION,
  );
  const digestValue = requestDigest({ file: input.file });
  const replay = await replayMutationReceipt(accountId, input.operationId, "package.restore.preview", digestValue);
  if (replay) {
    if (replay.kind !== "package-restore-previewed") {
      throw new Error("Package restore preview receipt has an unexpected result kind.");
    }
    return {
      planId: replay.planId,
      expectedStateRevision: replay.stateRevision,
      payloadDigest: replay.payloadDigest,
      expiresAt: replay.expiresAt,
      summary: replay.summary,
    };
  }

  assertDemoReplacementCount("themes", input.file.themes.length);
  validatePackageReferences(input.file);
  const canonicalThemes = input.file.themes.map((theme) => ({
    portableId: theme.portableId,
    ...validatedPortableTheme(theme, theme.browserValidation),
  }));
  const canonicalFile = appearancePackageV1Schema.parse({ ...input.file, themes: canonicalThemes });
  const payloadDigest = requestDigest(canonicalFile);

  return withAppearanceGate(accountId, async (tx, revision) => {
    const receipt = await readMutationReceipt(
      tx,
      accountId,
      input.operationId,
      "package.restore.preview",
      digestValue,
      revision.serverNow,
    );
    if (receipt) {
      if (receipt.kind !== "package-restore-previewed") {
        throw new Error("Package restore preview receipt has an unexpected result kind.");
      }
      return {
        planId: receipt.planId,
        expectedStateRevision: receipt.stateRevision,
        payloadDigest: receipt.payloadDigest,
        expiresAt: receipt.expiresAt,
        summary: receipt.summary,
      };
    }

    await cleanupExpiredRestorePlans(tx, accountId, revision.serverNow);
    await assertPackageNamesUniqueForDatabase(
      tx,
      canonicalFile.themes.map((theme) => theme.name),
    );
    const [config] = await tx
      .select()
      .from(appearanceConfigs)
      .where(eq(appearanceConfigs.accountId, accountId))
      .limit(1);
    if (!config) throw new Error("Appearance account is incomplete.");
    const themeCount = await tx.$count(appearanceThemes, eq(appearanceThemes.accountId, accountId));
    const draftCount = await tx.$count(appearanceThemeDrafts, eq(appearanceThemeDrafts.accountId, accountId));
    const summary = restoreSummarySchema.parse({
      existingThemeCount: themeCount,
      incomingThemeCount: canonicalFile.themes.length,
      removedDraftCount: draftCount,
      modeBefore: config.mode,
      modeAfter: canonicalFile.config.mode,
    });
    const expiresAt = new Date(
      revision.serverNow.getTime() + APPEARANCE_TECHNICAL_LIMITS.restorePlanMinutes * 60 * 1000,
    );
    const [plan] = await tx
      .insert(appearanceRestorePlans)
      .values({
        accountId,
        operationId: input.operationId,
        formatVersion: canonicalFile.version,
        canonicalPayload: canonicalFile,
        payloadDigest,
        expectedStateRevision: revision.stateRevision,
        summary,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [appearanceRestorePlans.accountId, appearanceRestorePlans.operationId],
        set: {
          formatVersion: canonicalFile.version,
          canonicalPayload: canonicalFile,
          payloadDigest,
          expectedStateRevision: revision.stateRevision,
          summary,
          expiresAt,
          appliedAt: null,
          appliedResult: null,
        },
      })
      .returning({ planId: appearanceRestorePlans.planId });
    if (!plan) throw new Error("Appearance restore plan could not be created.");

    await writeMutationReceipt(
      tx,
      accountId,
      input.operationId,
      "package.restore.preview",
      digestValue,
      "root",
      null,
      {
        kind: "package-restore-previewed",
        planId: plan.planId,
        payloadDigest,
        expiresAt: expiresAt.toISOString(),
        summary,
        stateRevision: revision.stateRevision.toString(),
        publishedRevision: revision.publishedRevision.toString(),
      },
      revision.serverNow,
      { expiresAt },
    );

    return {
      planId: plan.planId,
      expectedStateRevision: revision.stateRevision.toString(),
      payloadDigest,
      expiresAt: expiresAt.toISOString(),
      summary,
    };
  });
}

export async function confirmAppearanceRestore(
  accountId: string,
  planId: string,
  rawInput: unknown,
) {
  const input = restoreConfirmInputSchema.parse(rawInput);
  const startedAt = Date.now();
  try {
  const digestValue = requestDigest({ planId, payloadDigest: input.payloadDigest, expectedStateRevision: input.expectedStateRevision });
  let alreadyApplied = false;

  await withAppearanceGate(accountId, async (tx, revision) => {
    const receipt = await readMutationReceipt(
      tx,
      accountId,
      input.operationId,
      "package.restore",
      digestValue,
      revision.serverNow,
    );
    if (receipt && receipt.kind !== "package-restored") {
      throw new Error("Package restore receipt has an unexpected result kind.");
    }
    alreadyApplied = Boolean(receipt);
  });

  if (!alreadyApplied) {
    let reconfirmError: AppError | null = null;
    if (input.handle.resource.kind !== "root") {
      throw new AppError({ code: "APPEARANCE_LEASE_LOST", message: "整包恢复需要账户根租约。", status: 409 });
    }
    await withAppearanceLeases(
      accountId,
      input.holderToken,
      [input.handle],
      {
        receipt: {
          operationId: input.operationId,
          operationKind: "package.restore",
          digestValue,
        },
      },
      async (tx, revision, leaseRows, receipt) => {
        if (receipt) {
          if (receipt.kind !== "package-restored") {
            throw new Error("Package restore receipt has an unexpected result kind.");
          }
          alreadyApplied = true;
          return;
        }
        const [root] = leaseRows;
        if (!root || root.resourceKind !== "root") throw new Error("Validated restore is missing the root lease row.");
        const releaseRootForReconfirmation = async (message: string) => {
          await tx
            .update(appearanceLeases)
            .set({
              leaseId: null,
              holderTokenHash: null,
              expiresAt: null,
              renewedAt: revision.serverNow,
              releasedAt: revision.serverNow,
              requiresDraftResolution: false,
            })
            .where(eq(appearanceLeases.rowId, root.rowId));
          reconfirmError = new AppError({
            code: "APPEARANCE_RESTORE_RECONFIRM_REQUIRED",
            message,
            status: 409,
          });
        };
        // Gate acquisition keeps the short lock timeout; only the bounded final
        // replacement work receives the restore/export snapshot statement budget.
        await tx.execute(sql.raw(`set local statement_timeout = '${APPEARANCE_TECHNICAL_LIMITS.snapshotTimeoutMs}ms'`));
    const [plan] = await tx
      .select()
      .from(appearanceRestorePlans)
      .where(and(eq(appearanceRestorePlans.accountId, accountId), eq(appearanceRestorePlans.planId, planId)))
      .limit(1)
      .for("update");
        if (!plan || plan.expiresAt <= revision.serverNow) {
          await releaseRootForReconfirmation("恢复计划已过期，请重新预览。");
          return;
        }
    if (
      plan.payloadDigest !== input.payloadDigest ||
      plan.expectedStateRevision.toString() !== input.expectedStateRevision ||
      revision.stateRevision.toString() !== input.expectedStateRevision
        ) {
          await releaseRootForReconfirmation("外观状态已变化，请重新预览恢复摘要。");
          return;
        }
    const file = appearancePackageV1Schema.parse(plan.canonicalPayload);
        if (requestDigest(file) !== plan.payloadDigest) {
          await releaseRootForReconfirmation("恢复计划内容校验失败，请重新上传并预览。");
          return;
        }
    assertDemoReplacementCount("themes", file.themes.length);

    const idMap = new Map(file.themes.map((theme) => [theme.portableId, crypto.randomUUID()]));
    await tx
      .update(appearanceConfigs)
      .set({ lightThemeId: null, darkThemeId: null, updatedAt: revision.serverNow })
      .where(eq(appearanceConfigs.accountId, accountId));
    await tx.delete(appearanceThemes).where(eq(appearanceThemes.accountId, accountId));

    for (let index = 0; index < file.themes.length; index += APPEARANCE_TECHNICAL_LIMITS.restoreInsertBatch) {
      const batch = file.themes.slice(index, index + APPEARANCE_TECHNICAL_LIMITS.restoreInsertBatch);
      if (batch.length === 0) continue;
      await tx.insert(appearanceThemes).values(
        batch.map((theme) => ({
          id: idMap.get(theme.portableId),
          accountId,
          name: theme.name,
          declaredScheme: theme.declaredScheme,
          contractVersion: theme.tokenContractVersion,
          tokens: theme.tokens,
          validationCanvasColor: theme.validationCanvas.color,
          browserValidation: theme.browserValidation,
          themeRevision: 1n,
          createdAt: revision.serverNow,
          updatedAt: revision.serverNow,
        })),
      );
      await tx.insert(appearanceLeases).values(
        batch.map((theme) => ({
          accountId,
          resourceKind: "theme",
          themeId: idMap.get(theme.portableId),
          lockEpoch: revision.lockEpoch + 1n,
          releasedAt: revision.serverNow,
        })),
      );
    }

    const portableToDatabase = (selector: typeof file.config.lightTheme | typeof file.config.darkTheme) =>
      selector.kind === "custom" ? idMap.get(selector.portableId) ?? null : null;
    await tx
      .update(appearanceConfigs)
      .set({
        mode: file.config.mode,
        lightThemeId: portableToDatabase(file.config.lightTheme),
        darkThemeId: portableToDatabase(file.config.darkTheme),
        recoveryShortcut: file.config.recoveryShortcut,
        escapeRecoveryEnabled: file.config.escapeRecoveryEnabled,
        updatedAt: revision.serverNow,
      })
      .where(eq(appearanceConfigs.accountId, accountId));

    await tx
      .update(appearanceLeases)
      .set({
        leaseId: null,
        holderTokenHash: null,
        lockEpoch: revision.lockEpoch + 1n,
        expiresAt: null,
        renewedAt: revision.serverNow,
        releasedAt: revision.serverNow,
        requiresDraftResolution: false,
      })
      .where(eq(appearanceLeases.rowId, root.rowId));

    const [revisions] = await tx
      .update(appearanceLockState)
      .set({
        lockEpoch: sql`${appearanceLockState.lockEpoch} + 1`,
        stateRevision: sql`${appearanceLockState.stateRevision} + 1`,
        publishedRevision: sql`${appearanceLockState.publishedRevision} + 1`,
        updatedAt: revision.serverNow,
      })
      .where(eq(appearanceLockState.accountId, accountId))
      .returning({ stateRevision: appearanceLockState.stateRevision, publishedRevision: appearanceLockState.publishedRevision });
    if (!revisions) throw new Error("Appearance restore revision update failed.");
    const safeResult = { stateRevision: revisions.stateRevision.toString(), publishedRevision: revisions.publishedRevision.toString() };
    await tx
      .update(appearanceRestorePlans)
      .set({ appliedAt: revision.serverNow, appliedResult: safeResult })
      .where(eq(appearanceRestorePlans.planId, planId));
        await writeMutationReceipt(
          tx,
          accountId,
          input.operationId,
          "package.restore",
          digestValue,
          "root",
          null,
          {
            kind: "package-restored",
            stateRevision: revisions.stateRevision.toString(),
            publishedRevision: revisions.publishedRevision.toString(),
          },
          revision.serverNow,
          { restore: true },
        );
      },
    );
    if (reconfirmError) throw reconfirmError;
  }
  const snapshot = await getAppearanceSnapshot(accountId);
  logger.info({
    event: "appearance.restore.completed",
    userId: accountId,
    operationId: input.operationId,
    alreadyApplied,
    durationMs: Date.now() - startedAt,
    stateRevision: snapshot.stateRevision,
    publishedRevision: snapshot.publishedRevision,
  });
  return { snapshot };
  } catch (error) {
    logger.warn({
      event: "appearance.restore.failed",
      userId: accountId,
      operationId: input.operationId,
      code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
