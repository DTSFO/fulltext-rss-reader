import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import {
  appearanceConfigs,
  appearanceLeases,
  appearanceLockState,
  appearanceMutationReceipts,
  appearanceThemeDrafts,
} from "@/db/schema";
import {
  leaseStatusDataSchema,
  mutationReceiptSafeResultSchema,
  type LeaseHandle,
  type LeaseResource,
  type MutationReceiptSafeResult,
} from "@/features/appearance/schemas/appearance-schema";
import {
  decodeAppearanceLeaseStatusCursor,
  encodeAppearanceLeaseStatusCursor,
} from "@/features/appearance/server/lease-status-cursor";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";

type Database = ReturnType<typeof getDb>;
export type AppearanceTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type AppearanceRevision = {
  lockEpoch: bigint;
  stateRevision: bigint;
  publishedRevision: bigint;
  serverNow: Date;
};

export function hashAppearanceHolderToken(holderToken: string): string {
  return createHash("sha256").update(holderToken).digest("hex");
}

export function requestDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function ensureAppearanceAccount(accountId: string): Promise<void> {
  const db = getDb();
  const completion = await db.execute<{ complete: boolean }>(sql`
    select
      exists(select 1 from ${appearanceLockState} where ${appearanceLockState.accountId} = ${accountId})
      and exists(select 1 from ${appearanceConfigs} where ${appearanceConfigs.accountId} = ${accountId})
      and exists(
        select 1 from ${appearanceLeases}
        where ${appearanceLeases.accountId} = ${accountId}
          and ${appearanceLeases.resourceKind} = 'root'
      )
      and exists(
        select 1 from ${appearanceLeases}
        where ${appearanceLeases.accountId} = ${accountId}
          and ${appearanceLeases.resourceKind} = 'config'
      ) as complete
  `);
  if (Array.from(completion)[0]?.complete) return;

  await db.transaction(async (tx) => {
    await tx.insert(appearanceLockState).values({ accountId }).onConflictDoNothing();
    await tx
      .select({ accountId: appearanceLockState.accountId })
      .from(appearanceLockState)
      .where(eq(appearanceLockState.accountId, accountId))
      .for("update");
    await tx.insert(appearanceConfigs).values({ accountId }).onConflictDoNothing();
    await tx
      .insert(appearanceLeases)
      .values([
        { accountId, resourceKind: "root" },
        { accountId, resourceKind: "config" },
      ])
      .onConflictDoNothing();
  });
}

export async function withAppearanceGate<T>(
  accountId: string,
  callback: (tx: AppearanceTransaction, revision: AppearanceRevision) => Promise<T>,
): Promise<T> {
  await ensureAppearanceAccount(accountId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await getDb().transaction(async (tx) => {
        await tx.execute(sql.raw(`set local lock_timeout = '${APPEARANCE_TECHNICAL_LIMITS.gateLockTimeoutMs}ms'`));
        await tx.execute(sql.raw(`set local statement_timeout = '${APPEARANCE_TECHNICAL_LIMITS.statementTimeoutMs}ms'`));
        const [state] = await tx
          .select({
            lockEpoch: appearanceLockState.lockEpoch,
            stateRevision: appearanceLockState.stateRevision,
            publishedRevision: appearanceLockState.publishedRevision,
          })
          .from(appearanceLockState)
          .where(eq(appearanceLockState.accountId, accountId))
          .for("update");

        if (!state) {
          throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "外观配置不存在。", status: 404 });
        }
        // The clock must be sampled after FOR UPDATE returns. A target-list
        // clock_timestamp() in the locking SELECT may be evaluated before the
        // row-lock wait and would let an expired lease renew after contention.
        const [clock] = await tx
          .select({ serverNow: sql<Date>`clock_timestamp()`.mapWith(appearanceLockState.updatedAt) })
          .from(appearanceLockState)
          .where(eq(appearanceLockState.accountId, accountId))
          .limit(1);
        if (!clock) throw new Error("Database time could not be sampled after the appearance gate lock.");
        return callback(tx, { ...state, serverNow: clock.serverNow });
      });
    } catch (error) {
      const code = databaseErrorCode(error);
      if ((code === "40P01" || code === "40001") && attempt === 0) continue;
      if (code === "55P03" || code === "40P01" || code === "40001" || code === "57014") {
        throw new AppError({
          code: "APPEARANCE_BUSY",
          message: "外观配置正在处理其他请求，请稍后重试。",
          status: 503,
          details: { retryable: true },
          cause: error,
        });
      }
      throw error;
    }
  }
  throw new Error("Appearance gate retry loop exited unexpectedly.");
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function resourceIdentity(resource: LeaseResource): string {
  return resource.kind === "theme" ? `theme:${resource.themeId}` : resource.kind;
}

function resourceSort(first: LeaseResource, second: LeaseResource): number {
  const rank = { root: 0, config: 1, theme: 2 } as const;
  const difference = rank[first.kind] - rank[second.kind];
  if (difference !== 0) return difference;
  if (first.kind === "theme" && second.kind === "theme") return first.themeId.localeCompare(second.themeId);
  return 0;
}

export function normalizeResources(resources: LeaseResource[]): LeaseResource[] {
  const normalized = [...new Map(resources.map((resource) => [resourceIdentity(resource), resource])).values()].sort(resourceSort);
  if (normalized.some((resource) => resource.kind === "root") && normalized.length !== 1) {
    throw new AppError({
      code: "APPEARANCE_VALIDATION_FAILED",
      message: "账户根租约不能与子资源同时申请。",
      status: 422,
    });
  }
  return normalized;
}

export async function lockLeaseRows(
  tx: AppearanceTransaction,
  accountId: string,
  resources: LeaseResource[],
) {
  const normalized = normalizeResources(resources);
  const rows: (typeof appearanceLeases.$inferSelect)[] = [];

  const rootRequested = normalized.some((resource) => resource.kind === "root");
  const configRequested = normalized.some((resource) => resource.kind === "config");
  const themeIds = normalized.flatMap((resource) => (resource.kind === "theme" ? [resource.themeId] : []));

  const [root] = await tx
    .select()
    .from(appearanceLeases)
    .where(and(eq(appearanceLeases.accountId, accountId), eq(appearanceLeases.resourceKind, "root")))
    .for("update");
  if (!root) throw new Error("Appearance root lease row is missing.");
  if (rootRequested) rows.push(root);

  if (configRequested) {
    const [config] = await tx
      .select()
      .from(appearanceLeases)
      .where(and(eq(appearanceLeases.accountId, accountId), eq(appearanceLeases.resourceKind, "config")))
      .for("update");
    if (!config) throw new Error("Appearance config lease row is missing.");
    rows.push(config);
  }

  if (themeIds.length > 0) {
    const themes = await tx
      .select()
      .from(appearanceLeases)
      .where(
        and(
          eq(appearanceLeases.accountId, accountId),
          eq(appearanceLeases.resourceKind, "theme"),
          inArray(appearanceLeases.themeId, themeIds),
        ),
      )
      .orderBy(asc(appearanceLeases.themeId))
      .for("update");
    if (themes.length !== themeIds.length) {
      throw new AppError({ code: "APPEARANCE_NOT_FOUND", message: "主题不存在。", status: 404 });
    }
    rows.push(...themes);
  }

  return { normalized, rows, root };
}

function isEffective(
  row: typeof appearanceLeases.$inferSelect,
  revision: AppearanceRevision,
): boolean {
  return (
    row.lockEpoch === revision.lockEpoch &&
    row.leaseId !== null &&
    row.holderTokenHash !== null &&
    row.expiresAt !== null &&
    row.expiresAt > revision.serverNow
  );
}

function leaseResourceForRow(row: typeof appearanceLeases.$inferSelect): LeaseResource {
  if (row.resourceKind === "theme" && row.themeId) return { kind: "theme", themeId: row.themeId };
  return { kind: row.resourceKind === "root" ? "root" : "config" };
}

function conflictError(
  row: typeof appearanceLeases.$inferSelect,
  revision: AppearanceRevision,
  reason: "owned-partial-set" | "other-holder" = "other-holder",
): AppError {
  logger.warn({
    event: "appearance.lease.conflict",
    userId: row.accountId,
    resourceKind: row.resourceKind,
    ...(row.themeId ? { themeId: row.themeId } : {}),
    code: "APPEARANCE_LEASE_CONFLICT",
    reason,
    expiresAt: row.expiresAt?.toISOString(),
  });
  return new AppError({
    code: "APPEARANCE_LEASE_CONFLICT",
    message: reason === "owned-partial-set"
      ? "请先释放已持有的外观租约，再一次性申请完整资源集合。"
      : "该外观资源正在其他编辑会话中使用。",
    status: 423,
    details: {
      resourceKind: row.resourceKind,
      ...(row.themeId ? { themeId: row.themeId } : {}),
      expiresAt: row.expiresAt?.toISOString(),
      serverNow: revision.serverNow.toISOString(),
      retryable: reason === "other-holder",
    },
  });
}

export async function acquireAppearanceLeases(
  accountId: string,
  holderToken: string,
  resources: LeaseResource[],
): Promise<LeaseHandle[]> {
  const hash = hashAppearanceHolderToken(holderToken);
  return withAppearanceGate(accountId, async (tx, revision) => {
    const { normalized, rows, root } = await lockLeaseRows(tx, accountId, resources);
    const rootRequested = normalized[0]?.kind === "root";

    if (rootRequested) {
      const [activeChild] = await tx
        .select()
        .from(appearanceLeases)
        .where(
          and(
            eq(appearanceLeases.accountId, accountId),
            eq(appearanceLeases.lockEpoch, revision.lockEpoch),
            or(eq(appearanceLeases.resourceKind, "config"), eq(appearanceLeases.resourceKind, "theme")),
            sql`${appearanceLeases.leaseId} IS NOT NULL`,
            sql`${appearanceLeases.expiresAt} > clock_timestamp()`,
          ),
        )
        .limit(1)
        .for("update");
      if (activeChild) throw conflictError(activeChild, revision);
    } else if (isEffective(root, revision)) {
      throw conflictError(root, revision);
    }

    for (const row of rows) {
      if (isEffective(row, revision) && row.holderTokenHash !== hash) throw conflictError(row, revision);
    }
    const ownedEffectiveRows = rows.filter(
      (row) => isEffective(row, revision) && row.holderTokenHash === hash,
    );
    const [ownedEffectiveRow] = ownedEffectiveRows;
    if (ownedEffectiveRow && ownedEffectiveRows.length < rows.length) {
      throw conflictError(ownedEffectiveRow, revision, "owned-partial-set");
    }

    const requestedIdentities = new Set(normalized.map(resourceIdentity));
    const hiddenOwnedRows = await tx
      .select()
      .from(appearanceLeases)
      .where(
        and(
          eq(appearanceLeases.accountId, accountId),
          eq(appearanceLeases.lockEpoch, revision.lockEpoch),
          eq(appearanceLeases.holderTokenHash, hash),
          sql`${appearanceLeases.leaseId} IS NOT NULL`,
          sql`${appearanceLeases.expiresAt} > clock_timestamp()`,
        ),
      )
      .limit(normalized.length + 1)
      .for("update");
    const hiddenOwnedRow = hiddenOwnedRows.find(
      (row) => !requestedIdentities.has(resourceIdentity(leaseResourceForRow(row))),
    );
    if (hiddenOwnedRow) throw conflictError(hiddenOwnedRow, revision, "owned-partial-set");

    const expiresAt = new Date(revision.serverNow.getTime() + APPEARANCE_TECHNICAL_LIMITS.leaseSeconds * 1000);
    const handles: LeaseHandle[] = [];
    for (const row of rows) {
      const existing = isEffective(row, revision) && row.holderTokenHash === hash;
      const requiresDraftResolution = existing
        ? row.requiresDraftResolution
        : row.themeId
          ? Boolean(
              (
                await tx
                  .select({ themeId: appearanceThemeDrafts.themeId })
                  .from(appearanceThemeDrafts)
                  .where(
                    and(
                      eq(appearanceThemeDrafts.accountId, accountId),
                      eq(appearanceThemeDrafts.themeId, row.themeId),
                    ),
                  )
                  .limit(1)
              )[0],
            )
          : false;
      const leaseId = existing && row.leaseId ? row.leaseId : randomUUID();
      const fence = existing ? row.fence : row.fence + 1n;

      await tx
        .update(appearanceLeases)
        .set({
          leaseId,
          holderTokenHash: hash,
          lockEpoch: revision.lockEpoch,
          fence,
          acquiredAt: existing ? row.acquiredAt : revision.serverNow,
          renewedAt: revision.serverNow,
          expiresAt,
          releasedAt: null,
          requiresDraftResolution,
        })
        .where(eq(appearanceLeases.rowId, row.rowId));

      handles.push({
        resource: leaseResourceForRow(row),
        leaseId,
        lockEpoch: revision.lockEpoch.toString(),
        fence: fence.toString(),
        expiresAt: expiresAt.toISOString(),
        serverNow: revision.serverNow.toISOString(),
        requiresDraftResolution,
      });
    }
    return handles;
  });
}

function matchesHandle(
  row: typeof appearanceLeases.$inferSelect,
  handle: LeaseHandle,
  hash: string,
  revision: AppearanceRevision,
): boolean {
  return (
    isEffective(row, revision) &&
    row.leaseId === handle.leaseId &&
    row.holderTokenHash === hash &&
    row.lockEpoch.toString() === handle.lockEpoch &&
    row.fence.toString() === handle.fence &&
    resourceIdentity(leaseResourceForRow(row)) === resourceIdentity(handle.resource)
  );
}

export async function withAppearanceLeases<T>(
  accountId: string,
  holderToken: string,
  handles: LeaseHandle[],
  options: {
    allowDraftResolution?: boolean;
    receipt?: { operationId: string; operationKind: string; digestValue: string };
  },
  callback: (
    tx: AppearanceTransaction,
    revision: AppearanceRevision,
    rows: (typeof appearanceLeases.$inferSelect)[],
    receipt: MutationReceiptSafeResult | null,
  ) => Promise<T>,
): Promise<T> {
  const hash = hashAppearanceHolderToken(holderToken);
  return withAppearanceGate(accountId, async (tx, revision) => {
    if (options.receipt) {
      const receipt = await readMutationReceipt(
        tx,
        accountId,
        options.receipt.operationId,
        options.receipt.operationKind,
        options.receipt.digestValue,
        revision.serverNow,
      );
      if (receipt) return callback(tx, revision, [], receipt);
    }

    const { rows } = await lockLeaseRows(tx, accountId, handles.map((handle) => handle.resource));
    if (rows.length !== handles.length) {
      throw new AppError({ code: "APPEARANCE_LEASE_LOST", message: "外观编辑租约已失效。", status: 409 });
    }

    for (const row of rows) {
      const handle = handles.find(
        (candidate) => resourceIdentity(candidate.resource) === resourceIdentity(leaseResourceForRow(row)),
      );
      if (!handle || !matchesHandle(row, handle, hash, revision)) {
        const expired = row.expiresAt !== null && row.expiresAt <= revision.serverNow;
        const code = expired ? "APPEARANCE_LEASE_EXPIRED" : "APPEARANCE_LEASE_LOST";
        logger.warn({
          event: expired ? "appearance.lease.expired" : "appearance.lease.lost",
          userId: accountId,
          resourceKind: row.resourceKind,
          ...(row.themeId ? { themeId: row.themeId } : {}),
          code,
          expiresAt: row.expiresAt?.toISOString(),
        });
        throw new AppError({
          code,
          message: expired ? "外观编辑租约已过期。" : "外观编辑租约已失效。",
          status: 409,
          details: {
            resourceKind: row.resourceKind,
            ...(row.themeId ? { themeId: row.themeId } : {}),
            expiresAt: row.expiresAt?.toISOString(),
            serverNow: revision.serverNow.toISOString(),
            retryable: true,
          },
        });
      }
      if (row.requiresDraftResolution && !options.allowDraftResolution) {
        throw new AppError({
          code: "APPEARANCE_DRAFT_RESOLUTION_REQUIRED",
          message: "请先选择继续或丢弃已有草稿。",
          status: 409,
          details: { resourceKind: row.resourceKind, themeId: row.themeId, retryable: false },
        });
      }
    }

    return callback(tx, revision, rows, null);
  });
}

export async function renewAppearanceLeases(
  accountId: string,
  holderToken: string,
  handles: LeaseHandle[],
): Promise<LeaseHandle[]> {
  return withAppearanceLeases(accountId, holderToken, handles, { allowDraftResolution: true }, async (tx, revision, rows) => {
    const expiresAt = new Date(revision.serverNow.getTime() + APPEARANCE_TECHNICAL_LIMITS.leaseSeconds * 1000);
    for (const row of rows) {
      await tx
        .update(appearanceLeases)
        .set({ renewedAt: revision.serverNow, expiresAt })
        .where(eq(appearanceLeases.rowId, row.rowId));
    }
    return rows.map((row) => ({
      resource: leaseResourceForRow(row),
      leaseId: row.leaseId as string,
      lockEpoch: row.lockEpoch.toString(),
      fence: row.fence.toString(),
      expiresAt: expiresAt.toISOString(),
      serverNow: revision.serverNow.toISOString(),
      requiresDraftResolution: row.requiresDraftResolution,
    }));
  });
}

export async function releaseAppearanceLeases(
  accountId: string,
  holderToken: string,
  handles: LeaseHandle[],
): Promise<void> {
  await withAppearanceLeases(accountId, holderToken, handles, { allowDraftResolution: true }, async (tx, revision, rows) => {
    for (const row of rows) {
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
        .where(eq(appearanceLeases.rowId, row.rowId));
    }
  });
}

export async function bumpAppearanceRevision(
  tx: AppearanceTransaction,
  accountId: string,
  published: boolean,
): Promise<{ stateRevision: bigint; publishedRevision: bigint }> {
  const [updated] = await tx
    .update(appearanceLockState)
    .set({
      stateRevision: sql`${appearanceLockState.stateRevision} + 1`,
      ...(published ? { publishedRevision: sql`${appearanceLockState.publishedRevision} + 1` } : {}),
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(appearanceLockState.accountId, accountId))
    .returning({
      stateRevision: appearanceLockState.stateRevision,
      publishedRevision: appearanceLockState.publishedRevision,
    });
  if (!updated) throw new Error("Appearance revision could not be updated.");
  return updated;
}

export async function readMutationReceipt(
  tx: AppearanceTransaction,
  accountId: string,
  operationId: string,
  operationKind: string,
  digestValue: string,
  serverNow: Date,
): Promise<MutationReceiptSafeResult | null> {
  const [receipt] = await tx
    .select()
    .from(appearanceMutationReceipts)
    .where(
      and(
        eq(appearanceMutationReceipts.accountId, accountId),
        eq(appearanceMutationReceipts.operationId, operationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!receipt) return null;
  if (receipt.expiresAt <= serverNow) {
    await tx
      .delete(appearanceMutationReceipts)
      .where(
        and(
          eq(appearanceMutationReceipts.accountId, accountId),
          eq(appearanceMutationReceipts.operationId, operationId),
        ),
      );
    return null;
  }
  if (receipt.operationKind !== operationKind || receipt.requestDigest !== digestValue) {
    throw new AppError({
      code: "APPEARANCE_OPERATION_CONFLICT",
      message: "操作标识已用于不同的外观请求。",
      status: 409,
    });
  }
  const parsed = mutationReceiptSafeResultSchema.safeParse(receipt.safeResult);
  if (!parsed.success) {
    throw new Error("Appearance receipt has an invalid versioned safe result.");
  }
  return parsed.data;
}

export async function replayMutationReceipt(
  accountId: string,
  operationId: string,
  operationKind: string,
  digestValue: string,
): Promise<MutationReceiptSafeResult | null> {
  return withAppearanceGate(accountId, (tx, revision) =>
    readMutationReceipt(tx, accountId, operationId, operationKind, digestValue, revision.serverNow));
}

export async function replayableReceiptHandleInTransaction(
  tx: AppearanceTransaction,
  revision: AppearanceRevision,
  accountId: string,
  holderToken: string,
  handle: LeaseHandle | null,
): Promise<LeaseHandle | null> {
  if (!handle) return null;
  const { rows } = await lockLeaseRows(tx, accountId, [handle.resource]);
  const [row] = rows;
  return row && matchesHandle(row, handle, hashAppearanceHolderToken(holderToken), revision)
    ? handle
    : null;
}

export async function replayableReceiptHandle(
  accountId: string,
  holderToken: string,
  handle: LeaseHandle | null,
): Promise<LeaseHandle | null> {
  if (!handle) return null;
  try {
    return await withAppearanceGate(accountId, (tx, revision) =>
      replayableReceiptHandleInTransaction(tx, revision, accountId, holderToken, handle));
  } catch (error) {
    if (error instanceof AppError && error.code === "APPEARANCE_NOT_FOUND") return null;
    throw error;
  }
}

export async function writeMutationReceipt(
  tx: AppearanceTransaction,
  accountId: string,
  operationId: string,
  operationKind: string,
  digestValue: string,
  resourceKind: string,
  resourceId: string | null,
  safeResultValue: MutationReceiptSafeResult,
  serverNow: Date,
  options: { restore?: boolean; expiresAt?: Date } = {},
): Promise<void> {
  const expiresAt = options.expiresAt ?? new Date(
    serverNow.getTime() +
      (options.restore
        ? APPEARANCE_TECHNICAL_LIMITS.restoreReceiptDays * 24 * 60 * 60 * 1000
        : APPEARANCE_TECHNICAL_LIMITS.mutationReceiptHours * 60 * 60 * 1000),
  );
  const safeResult = mutationReceiptSafeResultSchema.parse(safeResultValue);
  await tx.insert(appearanceMutationReceipts).values({
    accountId,
    operationId,
    operationKind,
    resourceKind,
    resourceId,
    requestDigest: digestValue,
    safeResult,
    stateRevision: BigInt(safeResult.stateRevision),
    publishedRevision: BigInt(safeResult.publishedRevision),
    expiresAt,
  });
  await tx
    .delete(appearanceMutationReceipts)
    .where(
      and(
        eq(appearanceMutationReceipts.accountId, accountId),
        inArray(
          appearanceMutationReceipts.operationId,
          tx
            .select({ operationId: appearanceMutationReceipts.operationId })
            .from(appearanceMutationReceipts)
            .where(
              and(
                eq(appearanceMutationReceipts.accountId, accountId),
                lt(appearanceMutationReceipts.expiresAt, serverNow),
              ),
            )
            .limit(APPEARANCE_TECHNICAL_LIMITS.cleanupBatch),
        ),
      ),
    );
}

export async function claimOneShotConfigLease(
  tx: AppearanceTransaction,
  accountId: string,
  holderToken: string,
  revision: AppearanceRevision,
): Promise<typeof appearanceLeases.$inferSelect> {
  const { rows, root } = await lockLeaseRows(tx, accountId, [{ kind: "config" }]);
  const [config] = rows;
  if (!config) throw new Error("Appearance config lease row is missing.");
  if (isEffective(root, revision)) throw conflictError(root, revision);
  // A one-shot write has no existing handle to prove ownership. Even a
  // matching document token may belong to an in-flight config+theme
  // operation, so stealing and releasing that generation would invalidate it.
  if (isEffective(config, revision)) {
    const reason = config.holderTokenHash === hashAppearanceHolderToken(holderToken)
      ? "owned-partial-set"
      : "other-holder";
    throw conflictError(config, revision, reason);
  }
  const expiresAt = new Date(revision.serverNow.getTime() + APPEARANCE_TECHNICAL_LIMITS.leaseSeconds * 1000);
  await tx
    .update(appearanceLeases)
    .set({
      leaseId: randomUUID(),
      holderTokenHash: hashAppearanceHolderToken(holderToken),
      lockEpoch: revision.lockEpoch,
      fence: config.fence + 1n,
      acquiredAt: revision.serverNow,
      renewedAt: revision.serverNow,
      expiresAt,
      releasedAt: null,
      requiresDraftResolution: false,
    })
    .where(eq(appearanceLeases.rowId, config.rowId));
  return config;
}

export async function releaseOneShotLease(
  tx: AppearanceTransaction,
  rowId: string,
  serverNow: Date,
): Promise<void> {
  await tx
    .update(appearanceLeases)
    .set({
      leaseId: null,
      holderTokenHash: null,
      expiresAt: null,
      renewedAt: serverNow,
      releasedAt: serverNow,
      requiresDraftResolution: false,
    })
    .where(eq(appearanceLeases.rowId, rowId));
}

export async function assertRootAvailable(
  tx: AppearanceTransaction,
  accountId: string,
  revision: AppearanceRevision,
): Promise<void> {
  const { root } = await lockLeaseRows(tx, accountId, []);
  if (isEffective(root, revision)) throw conflictError(root, revision);
}

export async function createThemeLeaseRow(
  tx: AppearanceTransaction,
  accountId: string,
  themeId: string,
  holderToken: string,
  revision: AppearanceRevision,
  keepLease: boolean,
): Promise<LeaseHandle | null> {
  if (keepLease) {
    const [ownedLease] = await tx
      .select()
      .from(appearanceLeases)
      .where(
        and(
          eq(appearanceLeases.accountId, accountId),
          eq(appearanceLeases.lockEpoch, revision.lockEpoch),
          eq(appearanceLeases.holderTokenHash, hashAppearanceHolderToken(holderToken)),
          sql`${appearanceLeases.leaseId} IS NOT NULL`,
          sql`${appearanceLeases.expiresAt} > clock_timestamp()`,
        ),
      )
      .limit(1)
      .for("update");
    if (ownedLease) throw conflictError(ownedLease, revision, "owned-partial-set");
  }

  const leaseId = randomUUID();
  const expiresAt = new Date(revision.serverNow.getTime() + APPEARANCE_TECHNICAL_LIMITS.leaseSeconds * 1000);
  await tx.insert(appearanceLeases).values({
    accountId,
    resourceKind: "theme",
    themeId,
    fence: 1n,
    lockEpoch: revision.lockEpoch,
    ...(keepLease
      ? {
          leaseId,
          holderTokenHash: hashAppearanceHolderToken(holderToken),
          acquiredAt: revision.serverNow,
          renewedAt: revision.serverNow,
          expiresAt,
        }
      : { releasedAt: revision.serverNow }),
  });
  return keepLease
    ? {
        resource: { kind: "theme", themeId },
        leaseId,
        lockEpoch: revision.lockEpoch.toString(),
        fence: "1",
        expiresAt: expiresAt.toISOString(),
        serverNow: revision.serverNow.toISOString(),
        requiresDraftResolution: false,
      }
    : null;
}

export async function listAppearanceLeaseStatus(
  accountId: string,
  requesterToken: string | null,
  options: { cursor?: string | null; limit?: number } = {},
) {
  await ensureAppearanceAccount(accountId);
  const hash = requesterToken ? hashAppearanceHolderToken(requesterToken) : null;
  const boundedLimit = Math.min(
    APPEARANCE_TECHNICAL_LIMITS.listMaximum,
    Math.max(1, options.limit ?? APPEARANCE_TECHNICAL_LIMITS.listDefault),
  );
  const cursor = decodeAppearanceLeaseStatusCursor(options.cursor);
  if (options.cursor && !cursor) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "租约状态游标无效。", status: 400 });
  }

  const resourceRank = sql<number>`case ${appearanceLeases.resourceKind} when 'root' then 0 when 'config' then 1 else 2 end`;
  const afterCursor = cursor?.kind === "root"
    ? sql`${resourceRank} > 0`
    : cursor?.kind === "config"
      ? sql`${resourceRank} > 1`
      : cursor?.kind === "theme"
        ? and(eq(appearanceLeases.resourceKind, "theme"), gt(appearanceLeases.themeId, cursor.themeId))
        : undefined;

  const rows = await getDb()
    .select({
      resourceKind: appearanceLeases.resourceKind,
      themeId: appearanceLeases.themeId,
      holderTokenHash: appearanceLeases.holderTokenHash,
      expiresAt: appearanceLeases.expiresAt,
      serverNow: sql<Date>`clock_timestamp()`.mapWith(appearanceLeases.expiresAt),
    })
    .from(appearanceLeases)
    .innerJoin(
      appearanceLockState,
      and(
        eq(appearanceLockState.accountId, appearanceLeases.accountId),
        eq(appearanceLockState.lockEpoch, appearanceLeases.lockEpoch),
      ),
    )
    .where(
      and(
        eq(appearanceLeases.accountId, accountId),
        sql`${appearanceLeases.leaseId} IS NOT NULL`,
        sql`${appearanceLeases.expiresAt} > clock_timestamp()`,
        afterCursor,
      ),
    )
    .orderBy(asc(resourceRank), asc(appearanceLeases.themeId))
    .limit(boundedLimit + 1);

  const page = rows.slice(0, boundedLimit).map((row) => {
    const resource = row.resourceKind === "theme" && row.themeId
      ? ({ kind: "theme", themeId: row.themeId } as const)
      : row.resourceKind === "root"
        ? ({ kind: "root" } as const)
        : ({ kind: "config" } as const);
    return {
      resource,
      expiresAt: row.expiresAt?.toISOString() ?? row.serverNow.toISOString(),
      serverNow: row.serverNow.toISOString(),
      ownedByRequester: hash !== null && row.holderTokenHash === hash,
    };
  });
  const last = page.at(-1);
  return leaseStatusDataSchema.parse({
    items: page,
    nextCursor: rows.length > boundedLimit && last
      ? encodeAppearanceLeaseStatusCursor(last.resource)
      : null,
  });
}
