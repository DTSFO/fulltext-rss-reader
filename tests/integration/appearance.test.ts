import { and, eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appearanceConfigs,
  appearanceLeases,
  appearanceLockState,
  appearanceMutationReceipts,
  appearanceRestorePlans,
  appearanceThemeDrafts,
  appearanceThemes,
  users,
} from "@/db/schema";
import { appearancePackageV1Schema } from "@/features/appearance/schemas/appearance-schema";
import {
  acquireAppearanceLeases,
  hashAppearanceHolderToken,
  listAppearanceLeaseStatus,
  releaseAppearanceLeases,
  renewAppearanceLeases,
} from "@/features/appearance/server/appearance-db";
import {
  autosaveAppearanceTheme,
  createAppearanceTheme,
  deleteAppearanceTheme,
  mutateAppearanceConfig,
  mutateAppearanceTheme,
  previewChangeAppearanceThemeScheme,
  previewDeleteAppearanceTheme,
  resetAppearanceTheme,
  resolveAppearanceDraft,
  safetyRecoverAppearance,
} from "@/features/appearance/server/appearance-mutation-service";
import {
  getAppearanceSnapshot,
  getAppearanceTheme,
  listAppearanceThemes,
} from "@/features/appearance/server/appearance-query-service";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import {
  exportAppearancePackage,
  confirmAppearanceRestore,
  exportAppearanceTheme,
  importAppearanceTheme,
  prepareAppearancePackageDownload,
  previewAppearanceRestore,
} from "@/features/appearance/server/appearance-transfer-service";
import {
  BUILTIN_THEMES,
  DRAFT_CONTRACT_VERSION,
  cloneThemeTokens,
} from "@/features/appearance/theme-contract";
import { closeDb, getDb } from "@/lib/db/client";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
let accountId = "";

async function createAccount() {
  const [user] = await getDb().insert(users).values({ username: `appearance-${crypto.randomUUID()}` }).returning({ id: users.id });
  if (!user) throw new Error("Could not seed integration user.");
  return user.id;
}

async function createTheme(name: string, scheme: "light" | "dark" = "light") {
  const result = await createAppearanceTheme(accountId, {
    operationId: crypto.randomUUID(),
    holderToken: TOKEN_A,
    name,
    declaredScheme: scheme,
    source: { kind: "builtin", scheme },
    validationCanvas: BUILTIN_THEMES[scheme].validationCanvas,
    browserValidation: null,
    keepLease: false,
  });
  if ("kind" in result) throw new Error("A new operation unexpectedly replayed a create receipt.");
  return result;
}

beforeEach(async () => {
  accountId = await createAccount();
});

afterEach(async () => {
  if (accountId) await getDb().delete(users).where(eq(users.id, accountId));
});

afterAll(async () => {
  await closeDb();
});

describe("appearance PostgreSQL protocol", () => {
  it("bootstraps a bigint-safe built-in system account", async () => {
    const snapshot = await getAppearanceSnapshot(accountId);
    expect(snapshot).toMatchObject({
      stateRevision: "0",
      publishedRevision: "0",
      config: {
        mode: "system",
        lightTheme: { kind: "builtin" },
        darkTheme: { kind: "builtin" },
        escapeRecoveryEnabled: true,
      },
    });
    const [state] = await getDb().select().from(appearanceLockState).where(eq(appearanceLockState.accountId, accountId));
    expect(typeof state?.lockEpoch).toBe("bigint");
    expect(state?.updatedAt).toBeInstanceOf(Date);
  });

  it("keeps an already-bootstrapped snapshot read independent from the account gate", async () => {
    await getAppearanceSnapshot(accountId);
    let signalLocked: (() => void) | undefined;
    let releaseGate: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseGate = resolve; });
    const blocker = getDb().transaction(async (tx) => {
      await tx
        .select()
        .from(appearanceLockState)
        .where(eq(appearanceLockState.accountId, accountId))
        .for("update");
      signalLocked?.();
      await release;
    });
    await locked;

    const snapshotRead = getAppearanceSnapshot(accountId);
    const completedQuickly = await Promise.race([
      snapshotRead.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    releaseGate?.();
    await Promise.all([blocker, snapshotRead]);
    expect(completedQuickly).toBe(true);
  });

  it("uses database time after a gate wait so an expired lease cannot renew", async () => {
    const created = await createTheme("Gate expiry");
    const [handle] = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "theme", themeId: created.theme.id }]);
    if (!handle) throw new Error("Expected lease handle.");
    await getDb()
      .update(appearanceLeases)
      .set({ expiresAt: new Date(Date.now() + 150) })
      .where(and(eq(appearanceLeases.accountId, accountId), eq(appearanceLeases.themeId, created.theme.id)));

    let signalLocked: (() => void) | undefined;
    let releaseGate: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseGate = resolve; });
    const blocker = getDb().transaction(async (tx) => {
      await tx
        .select()
        .from(appearanceLockState)
        .where(eq(appearanceLockState.accountId, accountId))
        .for("update");
      signalLocked?.();
      await release;
    });
    await locked;

    const renewal = renewAppearanceLeases(accountId, TOKEN_A, [handle]).then(
      () => null,
      (error: unknown) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    releaseGate?.();
    await blocker;
    expect(await renewal).toMatchObject({ code: "APPEARANCE_LEASE_EXPIRED" });
  });

  it("serializes root/child races and allows independent themes", async () => {
    const first = await createTheme("First");
    const second = await createTheme("Second");
    const firstResource = { kind: "theme" as const, themeId: first.theme.id };
    const secondResource = { kind: "theme" as const, themeId: second.theme.id };

    const firstHandle = (await acquireAppearanceLeases(accountId, TOKEN_A, [firstResource]))[0];
    if (!firstHandle) throw new Error("Expected first lease.");
    await expect(acquireAppearanceLeases(accountId, TOKEN_B, [firstResource])).rejects.toMatchObject({ code: "APPEARANCE_LEASE_CONFLICT" });
    await expect(acquireAppearanceLeases(accountId, TOKEN_B, [secondResource])).resolves.toHaveLength(1);
    await expect(acquireAppearanceLeases(accountId, TOKEN_B, [{ kind: "root" }])).rejects.toMatchObject({ code: "APPEARANCE_LEASE_CONFLICT" });

    const secondHandle = (await acquireAppearanceLeases(accountId, TOKEN_B, [secondResource]))[0];
    if (!secondHandle) throw new Error("Expected second lease.");
    await releaseAppearanceLeases(accountId, TOKEN_A, [firstHandle]);
    await releaseAppearanceLeases(accountId, TOKEN_B, [secondHandle]);

    const race = await Promise.allSettled([
      acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "root" }]),
      acquireAppearanceLeases(accountId, TOKEN_B, [{ kind: "config" }]),
    ]);
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((result) => result.status === "rejected")).toHaveLength(1);
    for (const result of race) {
      if (result.status === "fulfilled") {
        const token = result.value[0]?.resource.kind === "root" ? TOKEN_A : TOKEN_B;
        await releaseAppearanceLeases(accountId, token, result.value);
      }
    }
  });

  it("rejects same-token partial-set expansion without claiming new resources", async () => {
    const created = await createTheme("No reverse expansion");
    const resource = { kind: "theme" as const, themeId: created.theme.id };
    const [themeHandle] = await acquireAppearanceLeases(accountId, TOKEN_A, [resource]);

    await expect(acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "config" }, resource]))
      .rejects.toMatchObject({
        code: "APPEARANCE_LEASE_CONFLICT",
        details: { retryable: false },
      });
    await expect(renewAppearanceLeases(accountId, TOKEN_A, [themeHandle])).resolves.toHaveLength(1);
    await expect(acquireAppearanceLeases(accountId, TOKEN_B, [{ kind: "config" }])).resolves.toHaveLength(1);
  });

  it("rejects hidden same-token expansion when the new request omits an already-held theme", async () => {
    const first = await createTheme("Hidden expansion first");
    const second = await createTheme("Hidden expansion second");
    const firstResource = { kind: "theme" as const, themeId: first.theme.id };
    const secondResource = { kind: "theme" as const, themeId: second.theme.id };
    const firstHandles = await acquireAppearanceLeases(accountId, TOKEN_A, [firstResource]);

    await expect(acquireAppearanceLeases(accountId, TOKEN_A, [secondResource]))
      .rejects.toMatchObject({
        code: "APPEARANCE_LEASE_CONFLICT",
        details: { retryable: false },
      });
    const secondHandles = await acquireAppearanceLeases(accountId, TOKEN_B, [secondResource]);
    expect(secondHandles).toHaveLength(1);
    await releaseAppearanceLeases(accountId, TOKEN_B, secondHandles);
    await releaseAppearanceLeases(accountId, TOKEN_A, firstHandles);
  });

  it("rejects create and import-then-edit when the token already owns another lease", async () => {
    const source = await createTheme("Held source");
    const held = await acquireAppearanceLeases(accountId, TOKEN_A, [
      { kind: "theme", themeId: source.theme.id },
    ]);
    const file = await exportAppearanceTheme(accountId, source.theme.id);
    const createOperationId = crypto.randomUUID();
    const importOperationId = crypto.randomUUID();

    await expect(createAppearanceTheme(accountId, {
      operationId: createOperationId,
      holderToken: TOKEN_A,
      name: "Hidden create lease",
      declaredScheme: "light",
      source: { kind: "builtin", scheme: "light" },
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
      keepLease: true,
    })).rejects.toMatchObject({
      code: "APPEARANCE_LEASE_CONFLICT",
      details: { retryable: false },
    });
    await expect(importAppearanceTheme(accountId, {
      operationId: importOperationId,
      holderToken: TOKEN_A,
      file,
      editAfterImport: true,
    })).rejects.toMatchObject({
      code: "APPEARANCE_LEASE_CONFLICT",
      details: { retryable: false },
    });

    expect(await getDb().$count(appearanceThemes, eq(appearanceThemes.accountId, accountId))).toBe(1);
    const receipts = await getDb()
      .select({ operationId: appearanceMutationReceipts.operationId })
      .from(appearanceMutationReceipts)
      .where(eq(appearanceMutationReceipts.accountId, accountId));
    expect(receipts.map((receipt) => receipt.operationId)).not.toContain(createOperationId);
    expect(receipts.map((receipt) => receipt.operationId)).not.toContain(importOperationId);
    await expect(renewAppearanceLeases(accountId, TOKEN_A, held)).resolves.toHaveLength(1);
    await releaseAppearanceLeases(accountId, TOKEN_A, held);
  });

  it("does not let a same-token one-shot config write steal an active config generation", async () => {
    const [handle] = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "config" }]);

    await expect(mutateAppearanceConfig(accountId, {
      action: "set-mode",
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      mode: "dark",
    })).rejects.toMatchObject({ code: "APPEARANCE_LEASE_CONFLICT" });

    const [renewed] = await renewAppearanceLeases(accountId, TOKEN_A, [handle]);
    expect(renewed).toMatchObject({ leaseId: handle.leaseId, fence: handle.fence });
  });

  it("blocks create and import under root without orphan themes, leases, or receipts", async () => {
    const source = await createTheme("Root source");
    const file = await exportAppearanceTheme(accountId, source.theme.id);
    const rootHandles = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "root" }]);
    const createOperationId = crypto.randomUUID();
    const importOperationId = crypto.randomUUID();

    await expect(createAppearanceTheme(accountId, {
      operationId: createOperationId,
      holderToken: TOKEN_B,
      name: "Blocked create",
      declaredScheme: "light",
      source: { kind: "builtin", scheme: "light" },
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
      keepLease: false,
    })).rejects.toMatchObject({ code: "APPEARANCE_LEASE_CONFLICT" });
    await expect(importAppearanceTheme(accountId, {
      operationId: importOperationId,
      holderToken: TOKEN_B,
      file,
      editAfterImport: false,
    })).rejects.toMatchObject({ code: "APPEARANCE_LEASE_CONFLICT" });

    expect(await getDb().$count(appearanceThemes, eq(appearanceThemes.accountId, accountId))).toBe(1);
    const receipts = await getDb()
      .select()
      .from(appearanceMutationReceipts)
      .where(eq(appearanceMutationReceipts.accountId, accountId));
    expect(receipts.some((receipt) => [createOperationId, importOperationId].includes(receipt.operationId))).toBe(false);
    const themeLeases = await getDb()
      .select()
      .from(appearanceLeases)
      .where(and(eq(appearanceLeases.accountId, accountId), eq(appearanceLeases.resourceKind, "theme")));
    expect(themeLeases).toHaveLength(1);
    await releaseAppearanceLeases(accountId, TOKEN_A, rootHandles);
  });

  it("serializes simultaneous root acquisition against create and import-then-edit", async () => {
    const createOperationId = crypto.randomUUID();
    const createRace = await Promise.allSettled([
      acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "root" }]),
      createAppearanceTheme(accountId, {
        operationId: createOperationId,
        holderToken: TOKEN_B,
        name: "Root race create",
        declaredScheme: "light",
        source: { kind: "builtin", scheme: "light" },
        validationCanvas: BUILTIN_THEMES.light.validationCanvas,
        browserValidation: null,
        keepLease: true,
      }),
    ]);
    expect(createRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(createRace.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rootResult = createRace[0];
    if (rootResult?.status === "fulfilled") {
      await releaseAppearanceLeases(accountId, TOKEN_A, rootResult.value);
    }
    const createResult = createRace[1];
    if (createResult?.status === "fulfilled" && !("kind" in createResult.value) && createResult.value.handle) {
      await releaseAppearanceLeases(accountId, TOKEN_B, [createResult.value.handle]);
    }

    const source = await createTheme("Root race import source");
    const file = await exportAppearanceTheme(accountId, source.theme.id);
    const importRace = await Promise.allSettled([
      importAppearanceTheme(accountId, {
        operationId: crypto.randomUUID(),
        holderToken: TOKEN_B,
        file,
        editAfterImport: true,
      }),
      acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "root" }]),
    ]);
    expect(importRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(importRace.filter((result) => result.status === "rejected")).toHaveLength(1);
    const importResult = importRace[0];
    if (importResult?.status === "fulfilled" && !("kind" in importResult.value) && importResult.value.handle) {
      await releaseAppearanceLeases(accountId, TOKEN_B, [importResult.value.handle]);
    }
    const importRootResult = importRace[1];
    if (importRootResult?.status === "fulfilled") {
      await releaseAppearanceLeases(accountId, TOKEN_A, importRootResult.value);
    }
  });

  it("acquires multi-resource sets all-or-nothing in canonical order", async () => {
    const first = await createTheme("First");
    const second = await createTheme("Second");
    const held = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "theme", themeId: first.theme.id }]);
    await expect(
      acquireAppearanceLeases(accountId, TOKEN_B, [
        { kind: "theme", themeId: second.theme.id },
        { kind: "config" },
        { kind: "theme", themeId: first.theme.id },
      ]),
    ).rejects.toMatchObject({ code: "APPEARANCE_LEASE_CONFLICT" });
    const active = await getDb()
      .select()
      .from(appearanceLeases)
      .where(and(eq(appearanceLeases.accountId, accountId), eq(appearanceLeases.holderTokenHash, hashAppearanceHolderToken(TOKEN_B))));
    expect(active).toHaveLength(0);
    await releaseAppearanceLeases(accountId, TOKEN_A, held);
  });

  it("canonicalizes simultaneous opposite-order theme sets without deadlock or partial claims", async () => {
    const first = await createTheme("Opposite first");
    const second = await createTheme("Opposite second");
    const forward = [
      { kind: "theme" as const, themeId: first.theme.id },
      { kind: "theme" as const, themeId: second.theme.id },
    ];
    const race = await Promise.allSettled([
      acquireAppearanceLeases(accountId, TOKEN_A, forward),
      acquireAppearanceLeases(accountId, TOKEN_B, [...forward].reverse()),
    ]);

    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((result) => result.status === "rejected")).toHaveLength(1);
    const active = await getDb()
      .select({ holderTokenHash: appearanceLeases.holderTokenHash })
      .from(appearanceLeases)
      .where(and(eq(appearanceLeases.accountId, accountId), isNotNull(appearanceLeases.holderTokenHash)));
    expect(active).toHaveLength(2);
    expect(new Set(active.map((row) => row.holderTokenHash)).size).toBe(1);

    const winnerIndex = race.findIndex((result) => result.status === "fulfilled");
    const winner = race[winnerIndex];
    if (winner?.status === "fulfilled") {
      await releaseAppearanceLeases(accountId, winnerIndex === 0 ? TOKEN_A : TOKEN_B, winner.value);
    }
  });

  it("preserves invalid autosave as a draft and atomically promotes a later valid snapshot", async () => {
    const created = await createTheme("Draftable");
    const [handle] = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "theme", themeId: created.theme.id }]);
    if (!handle) throw new Error("Expected theme handle.");
    const invalidTokens = cloneThemeTokens(created.theme.tokens);
    invalidTokens.foreground = { expression: "#ffffff", fallback: "#ffffffff" };
    const draft = await autosaveAppearanceTheme(accountId, created.theme.id, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      handle,
      expectedThemeRevision: created.theme.themeRevision,
      expectedDraftRevision: null,
      snapshot: {
        contractVersion: DRAFT_CONTRACT_VERSION,
        tokens: invalidTokens,
        validationCanvas: created.theme.validationCanvas,
        browserValidation: null,
      },
    });
    expect(draft.kind).toBe("draft-saved");
    const afterDraft = await getAppearanceSnapshot(accountId);
    expect(afterDraft.publishedRevision).toBe(created.snapshot.publishedRevision);
    await releaseAppearanceLeases(accountId, TOKEN_A, [handle]);

    const [successor] = await acquireAppearanceLeases(accountId, TOKEN_B, [{ kind: "theme", themeId: created.theme.id }]);
    if (!successor) throw new Error("Expected successor handle.");
    expect(successor.requiresDraftResolution).toBe(true);
    await expect(autosaveAppearanceTheme(accountId, created.theme.id, {
      operationId: crypto.randomUUID(), holderToken: TOKEN_B, handle: successor,
      expectedThemeRevision: created.theme.themeRevision, expectedDraftRevision: draft.draftRevision,
      snapshot: { contractVersion: 1, tokens: created.theme.tokens, validationCanvas: created.theme.validationCanvas, browserValidation: null },
    })).rejects.toMatchObject({ code: "APPEARANCE_DRAFT_RESOLUTION_REQUIRED" });

    await resolveAppearanceDraft(accountId, created.theme.id, {
      operationId: crypto.randomUUID(), holderToken: TOKEN_B, handle: successor, resolution: "resume",
    });
    const saved = await autosaveAppearanceTheme(accountId, created.theme.id, {
      operationId: crypto.randomUUID(), holderToken: TOKEN_B, handle: successor,
      expectedThemeRevision: created.theme.themeRevision, expectedDraftRevision: draft.draftRevision,
      snapshot: { contractVersion: 1, tokens: created.theme.tokens, validationCanvas: created.theme.validationCanvas, browserValidation: null },
    });
    expect(saved.kind).toBe("formal-saved");
    expect((await getAppearanceTheme(accountId, created.theme.id)).draft).toBeNull();
  });

  it("deletes a referenced theme atomically, cascades its draft and replays after recovery", async () => {
    const created = await createTheme("Delete with draft");
    await mutateAppearanceConfig(accountId, {
      action: "apply-theme",
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      themeId: created.theme.id,
    });
    const [draftHandle] = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "theme", themeId: created.theme.id }]);
    if (!draftHandle) throw new Error("Expected draft lease.");
    const invalidTokens = cloneThemeTokens(created.theme.tokens);
    invalidTokens.foreground = { expression: "transparent", fallback: "#00000000" };
    const draft = await autosaveAppearanceTheme(accountId, created.theme.id, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      handle: draftHandle,
      expectedThemeRevision: created.theme.themeRevision,
      expectedDraftRevision: null,
      snapshot: {
        contractVersion: DRAFT_CONTRACT_VERSION,
        tokens: invalidTokens,
        validationCanvas: created.theme.validationCanvas,
        browserValidation: null,
      },
    });
    expect(draft.kind).toBe("draft-saved");
    await releaseAppearanceLeases(accountId, TOKEN_A, [draftHandle]);

    const impact = await previewDeleteAppearanceTheme(accountId, created.theme.id);
    const handles = await acquireAppearanceLeases(accountId, TOKEN_B, [
      { kind: "config" },
      { kind: "theme", themeId: created.theme.id },
    ]);
    expect(handles.find((handle) => handle.resource.kind === "theme")?.requiresDraftResolution).toBe(true);
    const operationId = crypto.randomUUID();
    const input = {
      operationId,
      holderToken: TOKEN_B,
      handles,
      expectedStateRevision: impact.stateRevision,
      impactDigest: impact.impactDigest,
      discardDraft: true,
    };
    const deleted = await deleteAppearanceTheme(accountId, created.theme.id, input);
    expect(deleted.snapshot.config).toMatchObject({
      mode: "light",
      lightTheme: { kind: "builtin" },
    });
    expect(await getDb().$count(appearanceThemes, eq(appearanceThemes.accountId, accountId))).toBe(0);
    expect(await getDb().$count(appearanceThemeDrafts, eq(appearanceThemeDrafts.accountId, accountId))).toBe(0);
    expect(await getDb().$count(appearanceLeases, and(
      eq(appearanceLeases.accountId, accountId),
      eq(appearanceLeases.resourceKind, "theme"),
    ))).toBe(0);

    await safetyRecoverAppearance(accountId, { operationId: crypto.randomUUID() });
    await expect(deleteAppearanceTheme(accountId, created.theme.id, input)).resolves.toMatchObject({ deleted: true });
  });

  it("replays a committed create with the same theme and active generation after response loss", async () => {
    const operationId = crypto.randomUUID();
    const input = {
      operationId,
      holderToken: TOKEN_A,
      name: "Create response loss",
      declaredScheme: "light" as const,
      source: { kind: "builtin" as const, scheme: "light" as const },
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
      keepLease: true,
    };

    const first = await createAppearanceTheme(accountId, input);
    const replay = await createAppearanceTheme(accountId, input);
    if ("kind" in first || "kind" in replay) throw new Error("Existing created theme should return its current resource.");

    expect(replay.theme.id).toBe(first.theme.id);
    expect(replay.handle).toMatchObject({
      leaseId: first.handle?.leaseId,
      fence: first.handle?.fence,
      lockEpoch: first.handle?.lockEpoch,
    });
    expect(replay.snapshot.stateRevision).toBe(first.snapshot.stateRevision);
  });

  it("returns a stable completed create receipt after the created theme was later deleted", async () => {
    const operationId = crypto.randomUUID();
    const input = {
      operationId,
      holderToken: TOKEN_A,
      name: "Deleted after create",
      declaredScheme: "light" as const,
      source: { kind: "builtin" as const, scheme: "light" as const },
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
      keepLease: false,
    };
    const created = await createAppearanceTheme(accountId, input);
    if ("kind" in created) throw new Error("Initial create unexpectedly replayed a receipt.");
    await getDb().delete(appearanceThemes).where(eq(appearanceThemes.id, created.theme.id));

    await expect(createAppearanceTheme(accountId, input)).resolves.toMatchObject({
      kind: "operation-completed",
      operation: "create",
      themeId: created.theme.id,
      themeRevision: "1",
    });
  });

  it("replays reset after the target theme was later deleted", async () => {
    const created = await createTheme("Reset then delete");
    const [handle] = await acquireAppearanceLeases(accountId, TOKEN_A, [
      { kind: "theme", themeId: created.theme.id },
    ]);
    if (!handle) throw new Error("Expected reset lease.");
    const input = {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      handle,
      expectedThemeRevision: created.theme.themeRevision,
      source: { kind: "builtin" as const, scheme: "light" as const },
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
    };
    await resetAppearanceTheme(accountId, created.theme.id, input);
    await releaseAppearanceLeases(accountId, TOKEN_A, [handle]);
    await getDb().delete(appearanceThemes).where(eq(appearanceThemes.id, created.theme.id));

    await expect(resetAppearanceTheme(accountId, created.theme.id, input)).resolves.toMatchObject({
      snapshot: { stateRevision: expect.any(String) },
    });
  });

  it("replays draft resolution after the target theme was later deleted", async () => {
    const created = await createTheme("Resolve then delete");
    const [draftHandle] = await acquireAppearanceLeases(accountId, TOKEN_A, [
      { kind: "theme", themeId: created.theme.id },
    ]);
    if (!draftHandle) throw new Error("Expected draft lease.");
    const invalidTokens = cloneThemeTokens(created.theme.tokens);
    invalidTokens.foreground = { expression: "transparent", fallback: "#00000000" };
    await autosaveAppearanceTheme(accountId, created.theme.id, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      handle: draftHandle,
      expectedThemeRevision: created.theme.themeRevision,
      expectedDraftRevision: null,
      snapshot: {
        contractVersion: DRAFT_CONTRACT_VERSION,
        tokens: invalidTokens,
        validationCanvas: created.theme.validationCanvas,
        browserValidation: null,
      },
    });
    await releaseAppearanceLeases(accountId, TOKEN_A, [draftHandle]);
    const [resolveHandle] = await acquireAppearanceLeases(accountId, TOKEN_B, [
      { kind: "theme", themeId: created.theme.id },
    ]);
    if (!resolveHandle) throw new Error("Expected draft-resolution lease.");
    const input = {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_B,
      handle: resolveHandle,
      resolution: "discard" as const,
    };
    await resolveAppearanceDraft(accountId, created.theme.id, input);
    await releaseAppearanceLeases(accountId, TOKEN_B, [resolveHandle]);
    await getDb().delete(appearanceThemes).where(eq(appearanceThemes.id, created.theme.id));

    await expect(resolveAppearanceDraft(accountId, created.theme.id, input)).resolves.toEqual({
      resolved: true,
      draft: null,
      stateRevision: expect.any(String),
    });
  });

  it("replays autosave before stale lease checks after recovery and rejects digest reuse", async () => {
    const created = await createTheme("Autosave response loss");
    const [handle] = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "theme", themeId: created.theme.id }]);
    if (!handle) throw new Error("Expected theme handle.");
    const operationId = crypto.randomUUID();
    const input = {
      operationId,
      holderToken: TOKEN_A,
      handle,
      expectedThemeRevision: created.theme.themeRevision,
      expectedDraftRevision: null,
      snapshot: {
        contractVersion: DRAFT_CONTRACT_VERSION,
        tokens: created.theme.tokens,
        validationCanvas: created.theme.validationCanvas,
        browserValidation: null,
      },
    };

    const saved = await autosaveAppearanceTheme(accountId, created.theme.id, input);
    expect(saved.kind).toBe("formal-saved");
    await safetyRecoverAppearance(accountId, { operationId: crypto.randomUUID() });
    const afterRecovery = await getAppearanceSnapshot(accountId);

    const replay = await autosaveAppearanceTheme(accountId, created.theme.id, input);
    expect(replay).toMatchObject({
      kind: "operation-completed",
      outcome: "formal-saved",
      themeId: created.theme.id,
    });
    expect((await getAppearanceSnapshot(accountId)).stateRevision).toBe(afterRecovery.stateRevision);

    await expect(autosaveAppearanceTheme(accountId, created.theme.id, {
      ...input,
      snapshot: {
        ...input.snapshot,
        tokens: {
          ...input.snapshot.tokens,
          background: { ...input.snapshot.tokens.background, expression: "red" },
        },
      },
    })).rejects.toMatchObject({ code: "APPEARANCE_OPERATION_CONFLICT" });
  });

  it("treats expired receipts as absent while active digest mismatches remain conflicts", async () => {
    const operationId = crypto.randomUUID();
    const input = {
      action: "set-mode" as const,
      operationId,
      holderToken: TOKEN_A,
      mode: "dark" as const,
    };
    const first = await mutateAppearanceConfig(accountId, input);
    await getDb()
      .update(appearanceMutationReceipts)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(and(
        eq(appearanceMutationReceipts.accountId, accountId),
        eq(appearanceMutationReceipts.operationId, operationId),
      ));

    const afterExpiry = await mutateAppearanceConfig(accountId, input);
    expect(BigInt(afterExpiry.snapshot.stateRevision)).toBe(BigInt(first.snapshot.stateRevision) + 1n);
    await expect(mutateAppearanceConfig(accountId, { ...input, mode: "light" as const }))
      .rejects.toMatchObject({ code: "APPEARANCE_OPERATION_CONFLICT" });
  });

  it("fences stale renew/release after expiry takeover and recovery", async () => {
    const created = await createTheme("Fence");
    const [oldHandle] = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "theme", themeId: created.theme.id }]);
    if (!oldHandle) throw new Error("Expected old handle.");
    await getDb()
      .update(appearanceLeases)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(and(eq(appearanceLeases.accountId, accountId), eq(appearanceLeases.themeId, created.theme.id)));
    const [successor] = await acquireAppearanceLeases(accountId, TOKEN_B, [{ kind: "theme", themeId: created.theme.id }]);
    if (!successor) throw new Error("Expected successor handle.");
    expect(BigInt(successor.fence)).toBeGreaterThan(BigInt(oldHandle.fence));
    await expect(renewAppearanceLeases(accountId, TOKEN_A, [oldHandle])).rejects.toMatchObject({ code: "APPEARANCE_LEASE_LOST" });
    await expect(releaseAppearanceLeases(accountId, TOKEN_A, [oldHandle])).rejects.toMatchObject({ code: "APPEARANCE_LEASE_LOST" });
    await expect(autosaveAppearanceTheme(accountId, created.theme.id, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      handle: oldHandle,
      expectedThemeRevision: created.theme.themeRevision,
      expectedDraftRevision: null,
      snapshot: {
        contractVersion: DRAFT_CONTRACT_VERSION,
        tokens: created.theme.tokens,
        validationCanvas: created.theme.validationCanvas,
        browserValidation: null,
      },
    })).rejects.toMatchObject({ code: "APPEARANCE_LEASE_LOST" });
    await expect(autosaveAppearanceTheme(accountId, created.theme.id, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_B,
      handle: successor,
      expectedThemeRevision: created.theme.themeRevision,
      expectedDraftRevision: null,
      snapshot: {
        contractVersion: DRAFT_CONTRACT_VERSION,
        tokens: created.theme.tokens,
        validationCanvas: created.theme.validationCanvas,
        browserValidation: null,
      },
    })).resolves.toMatchObject({ kind: "formal-saved" });

    await safetyRecoverAppearance(accountId, { operationId: crypto.randomUUID() });
    await expect(renewAppearanceLeases(accountId, TOKEN_B, [successor])).rejects.toMatchObject({ code: "APPEARANCE_LEASE_LOST" });
    const recovered = await getAppearanceSnapshot(accountId);
    expect(recovered.config).toMatchObject({ mode: "system", lightTheme: { kind: "builtin" }, darkTheme: { kind: "builtin" } });
  });

  it("linearizes safety recovery against an in-flight formal autosave", async () => {
    const created = await createTheme("Recovery race");
    const [handle] = await acquireAppearanceLeases(accountId, TOKEN_A, [
      { kind: "theme", themeId: created.theme.id },
    ]);
    if (!handle) throw new Error("Expected recovery-race lease.");
    const race = await Promise.allSettled([
      safetyRecoverAppearance(accountId, { operationId: crypto.randomUUID() }),
      autosaveAppearanceTheme(accountId, created.theme.id, {
        operationId: crypto.randomUUID(),
        holderToken: TOKEN_A,
        handle,
        expectedThemeRevision: created.theme.themeRevision,
        expectedDraftRevision: null,
        snapshot: {
          contractVersion: DRAFT_CONTRACT_VERSION,
          tokens: created.theme.tokens,
          validationCanvas: created.theme.validationCanvas,
          browserValidation: null,
        },
      }),
    ]);

    expect(race[0]?.status).toBe("fulfilled");
    if (race[1]?.status === "rejected") {
      expect(race[1].reason).toMatchObject({ code: "APPEARANCE_LEASE_LOST" });
    } else {
      expect(race[1]?.value).toMatchObject({ kind: "formal-saved" });
    }
    expect((await getAppearanceSnapshot(accountId)).config).toMatchObject({
      mode: "system",
      lightTheme: { kind: "builtin" },
      darkTheme: { kind: "builtin" },
    });
    expect((await getAppearanceTheme(accountId, created.theme.id)).draft).toBeNull();
  });

  it("paginates and searches theme summaries with validated stable cursors", async () => {
    const created = await Promise.all([
      createTheme("Theme page A"),
      createTheme("Theme page B"),
      createTheme("100% literal"),
    ]);
    const first = await listAppearanceThemes(accountId, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listAppearanceThemes(accountId, { cursor: first.nextCursor, limit: 1 });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);

    const searched = await listAppearanceThemes(accountId, { query: "100%" });
    expect(searched.items.map((theme) => theme.id)).toEqual([created[2]?.theme.id]);

    const malformed = Buffer.from(JSON.stringify({
      updatedAt: new Date().toISOString(),
      id: "not-a-uuid",
    }), "utf8").toString("base64url");
    await expect(listAppearanceThemes(accountId, { cursor: malformed }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("paginates active lease status with stable cursors and no holder metadata", async () => {
    const created = await Promise.all([
      createTheme("Lease page 1"),
      createTheme("Lease page 2"),
      createTheme("Lease page 3"),
    ]);
    const handles = await acquireAppearanceLeases(accountId, TOKEN_A, [
      { kind: "config" },
      ...created.map((item) => ({ kind: "theme" as const, themeId: item.theme.id })),
    ]);

    const resources: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listAppearanceLeaseStatus(accountId, TOKEN_A, { cursor, limit: 2 });
      expect(page.items.length).toBeLessThanOrEqual(2);
      for (const item of page.items) {
        resources.push(item.resource.kind === "theme" ? `theme:${item.resource.themeId}` : item.resource.kind);
        expect(item.ownedByRequester).toBe(true);
        expect(JSON.stringify(item)).not.toMatch(/holderToken|holderTokenHash|leaseId/);
      }
      cursor = page.nextCursor;
    } while (cursor);

    expect(resources).toEqual([
      "config",
      ...created.map((item) => `theme:${item.theme.id}`).sort(),
    ]);
    await expect(listAppearanceLeaseStatus(accountId, null, { cursor: "malformed", limit: 2 }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await releaseAppearanceLeases(accountId, TOKEN_A, handles);
  });

  it("returns the dedicated unsupported error for unknown portable formats", async () => {
    await expect(importAppearanceTheme(accountId, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      file: { kind: "fulltext-rss-reader.theme", version: 999 },
      editAfterImport: false,
    })).rejects.toMatchObject({ code: "APPEARANCE_IMPORT_UNSUPPORTED" });
    await expect(previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file: { kind: "fulltext-rss-reader.appearance-package", version: 999 },
    })).rejects.toMatchObject({ code: "APPEARANCE_IMPORT_UNSUPPORTED" });
  });

  it("allocates stable distinct names for simultaneous same-name imports without orphan rows", async () => {
    const original = await createTheme("Shared import name");
    const file = await exportAppearanceTheme(accountId, original.theme.id);
    const [firstImport, secondImport] = await Promise.all([
      importAppearanceTheme(accountId, {
        operationId: crypto.randomUUID(),
        holderToken: TOKEN_A,
        file,
        editAfterImport: false,
      }),
      importAppearanceTheme(accountId, {
        operationId: crypto.randomUUID(),
        holderToken: TOKEN_B,
        file,
        editAfterImport: false,
      }),
    ]);
    if ("kind" in firstImport || "kind" in secondImport) {
      throw new Error("New imports unexpectedly replayed an operation receipt.");
    }

    expect([firstImport.theme.name, secondImport.theme.name].sort()).toEqual([
      "Shared import name (2)",
      "Shared import name (3)",
    ]);
    const importedIds = [firstImport.theme.id, secondImport.theme.id];
    const leases = await getDb()
      .select()
      .from(appearanceLeases)
      .where(and(eq(appearanceLeases.accountId, accountId), eq(appearanceLeases.resourceKind, "theme")));
    const importedLeases = leases.filter((lease) => lease.themeId && importedIds.includes(lease.themeId));
    expect(importedLeases).toHaveLength(2);
    expect(importedLeases.every((lease) => lease.leaseId === null && lease.holderTokenHash === null)).toBe(true);

    const receipts = await getDb()
      .select()
      .from(appearanceMutationReceipts)
      .where(and(
        eq(appearanceMutationReceipts.accountId, accountId),
        eq(appearanceMutationReceipts.operationKind, "theme.import"),
      ));
    expect(receipts).toHaveLength(2);
    expect(new Set(receipts.map((receipt) => receipt.resourceId))).toEqual(new Set(importedIds));
  });

  it("returns a stable completed import receipt after the imported theme was later deleted", async () => {
    const original = await createTheme("Import then delete source");
    const file = await exportAppearanceTheme(accountId, original.theme.id);
    const operationId = crypto.randomUUID();
    const input = {
      operationId,
      holderToken: TOKEN_A,
      file,
      editAfterImport: false,
    };
    const imported = await importAppearanceTheme(accountId, input);
    if ("kind" in imported) throw new Error("Initial import unexpectedly replayed a receipt.");
    await getDb().delete(appearanceThemes).where(eq(appearanceThemes.id, imported.theme.id));

    await expect(importAppearanceTheme(accountId, input)).resolves.toMatchObject({
      kind: "operation-completed",
      operation: "import",
      themeId: imported.theme.id,
      themeRevision: "1",
    });
  });

  it("rejects restore names that collide under PostgreSQL lower semantics", async () => {
    await createTheme("Unicode light", "light");
    await createTheme("Unicode dark", "dark");
    const packageFile = await exportAppearancePackage(accountId);
    const unicodeFile = {
      ...packageFile,
      themes: packageFile.themes.map((theme, index) => ({
        ...theme,
        name: index === 0 ? "İ" : "i",
      })),
    };
    await expect(previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file: unicodeFile,
    })).rejects.toMatchObject({ code: "APPEARANCE_NAME_CONFLICT" });
    expect(await getDb().$count(appearanceRestorePlans, eq(appearanceRestorePlans.accountId, accountId))).toBe(0);
  });

  it("atomically migrates a theme while preserving an unrelated old slot and replacing only the target slot", async () => {
    const target = await createTheme("Move to dark", "light");
    const lightOther = await createTheme("Keep in light", "light");
    const darkDisplaced = await createTheme("Displaced but retained", "dark");
    await mutateAppearanceConfig(accountId, {
      action: "set-slot", operationId: crypto.randomUUID(), holderToken: TOKEN_A,
      scheme: "light", selector: { kind: "custom", themeId: lightOther.theme.id },
    });
    await mutateAppearanceConfig(accountId, {
      action: "set-slot", operationId: crypto.randomUUID(), holderToken: TOKEN_A,
      scheme: "dark", selector: { kind: "custom", themeId: darkDisplaced.theme.id },
    });
    await mutateAppearanceConfig(accountId, {
      action: "set-mode", operationId: crypto.randomUUID(), holderToken: TOKEN_A, mode: "light",
    });
    const impact = await previewChangeAppearanceThemeScheme(
      accountId,
      target.theme.id,
      "dark",
      "light",
      BUILTIN_THEMES.dark.validationCanvas.color,
    );
    const handles = await acquireAppearanceLeases(accountId, TOKEN_A, [
      { kind: "config" },
      { kind: "theme", themeId: target.theme.id },
    ]);
    const result = await mutateAppearanceTheme(accountId, target.theme.id, {
      action: "change-scheme",
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      handles,
      expectedStateRevision: impact.stateRevision,
      declaredScheme: "dark",
      resolvedSystemSchemeAtConfirmation: "light",
      validationCanvas: BUILTIN_THEMES.dark.validationCanvas,
      browserValidation: null,
      impactDigest: impact.impactDigest,
    });

    expect(result.snapshot.config).toMatchObject({
      mode: "light",
      lightTheme: { kind: "custom", themeId: lightOther.theme.id },
      darkTheme: { kind: "custom", themeId: target.theme.id },
    });
    expect((await getAppearanceTheme(accountId, target.theme.id)).theme.declaredScheme).toBe("dark");
    expect((await getAppearanceTheme(accountId, darkDisplaced.theme.id)).theme.name).toBe("Displaced but retained");
    await releaseAppearanceLeases(accountId, TOKEN_A, handles);
  });

  it("rejects a scheme-change digest when locked config changes without a revision bump", async () => {
    const target = await createTheme("Target light", "light");
    const displaced = await createTheme("Displaced dark", "dark");
    await mutateAppearanceConfig(accountId, {
      action: "set-slot", operationId: crypto.randomUUID(), holderToken: TOKEN_A,
      scheme: "light", selector: { kind: "custom", themeId: target.theme.id },
    });
    await mutateAppearanceConfig(accountId, {
      action: "set-slot", operationId: crypto.randomUUID(), holderToken: TOKEN_A,
      scheme: "dark", selector: { kind: "custom", themeId: displaced.theme.id },
    });
    await mutateAppearanceConfig(accountId, {
      action: "set-mode", operationId: crypto.randomUUID(), holderToken: TOKEN_A, mode: "light",
    });
    const impact = await previewChangeAppearanceThemeScheme(
      accountId,
      target.theme.id,
      "dark",
      "light",
      BUILTIN_THEMES.dark.validationCanvas.color,
    );
    const handles = await acquireAppearanceLeases(accountId, TOKEN_A, [
      { kind: "config" },
      { kind: "theme", themeId: target.theme.id },
    ]);

    let releaseConfigRow: (() => void) | undefined;
    let configRowLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => { configRowLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseConfigRow = resolve; });
    const blocker = getDb().transaction(async (tx) => {
      await tx
        .select()
        .from(appearanceLeases)
        .where(and(eq(appearanceLeases.accountId, accountId), eq(appearanceLeases.resourceKind, "config")))
        .for("update");
      configRowLocked?.();
      await release;
      await tx
        .update(appearanceConfigs)
        .set({ mode: "system" })
        .where(eq(appearanceConfigs.accountId, accountId));
    });
    await locked;

    const mutation = mutateAppearanceTheme(accountId, target.theme.id, {
      action: "change-scheme",
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      handles,
      expectedStateRevision: impact.stateRevision,
      declaredScheme: "dark",
      resolvedSystemSchemeAtConfirmation: "light",
      validationCanvas: BUILTIN_THEMES.dark.validationCanvas,
      browserValidation: null,
      impactDigest: impact.impactDigest,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseConfigRow?.();
    await blocker;
    await expect(mutation).rejects.toMatchObject({ code: "APPEARANCE_RECONFIRM_REQUIRED" });

    const [stored] = await getDb()
      .select({ declaredScheme: appearanceThemes.declaredScheme })
      .from(appearanceThemes)
      .where(eq(appearanceThemes.id, target.theme.id));
    expect(stored?.declaredScheme).toBe("light");
    await releaseAppearanceLeases(accountId, TOKEN_A, handles);
  });

  it("cleans expired restore plans in a bounded preview write path", async () => {
    await createTheme("Restore plan cleanup");
    const file = await exportAppearancePackage(accountId);
    const expired = await previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file,
    });
    await getDb()
      .update(appearanceRestorePlans)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(appearanceRestorePlans.planId, expired.planId));

    const fresh = await previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file,
    });
    const plans = await getDb()
      .select({ planId: appearanceRestorePlans.planId })
      .from(appearanceRestorePlans)
      .where(eq(appearanceRestorePlans.accountId, accountId));
    expect(plans.map((plan) => plan.planId)).toEqual([fresh.planId]);
  });

  it("reconfirms stale restore plans, then exactly restores and replays a lost response", async () => {
    const kept = await createTheme("Kept by restore");
    const packageFile = await exportAppearancePackage(accountId);
    const removed = await createTheme("Removed by restore");
    const [draftHandle] = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "theme", themeId: removed.theme.id }]);
    if (!draftHandle) throw new Error("Expected draft handle.");
    const invalidTokens = cloneThemeTokens(removed.theme.tokens);
    invalidTokens.foreground = { expression: "transparent", fallback: "#00000000" };
    await autosaveAppearanceTheme(accountId, removed.theme.id, {
      operationId: crypto.randomUUID(), holderToken: TOKEN_A, handle: draftHandle,
      expectedThemeRevision: removed.theme.themeRevision, expectedDraftRevision: null,
      snapshot: { contractVersion: 1, tokens: invalidTokens, validationCanvas: removed.theme.validationCanvas, browserValidation: null },
    });
    await releaseAppearanceLeases(accountId, TOKEN_A, [draftHandle]);
    const preview = await previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file: packageFile,
    });
    expect(preview.summary).toMatchObject({
      existingThemeCount: 2,
      incomingThemeCount: 1,
      removedDraftCount: 1,
    });

    await mutateAppearanceConfig(accountId, {
      action: "set-mode", operationId: crypto.randomUUID(), holderToken: TOKEN_A, mode: "dark",
    });
    const staleRoot = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "root" }]);
    await expect(confirmAppearanceRestore(accountId, preview.planId, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      handle: staleRoot[0],
      payloadDigest: preview.payloadDigest,
      expectedStateRevision: preview.expectedStateRevision,
    })).rejects.toMatchObject({ code: "APPEARANCE_RESTORE_RECONFIRM_REQUIRED" });
    const configAfterReconfirmation = await acquireAppearanceLeases(accountId, TOKEN_B, [{ kind: "config" }]);
    expect(configAfterReconfirmation).toHaveLength(1);
    await releaseAppearanceLeases(accountId, TOKEN_B, configAfterReconfirmation);
    expect(await getDb().$count(appearanceThemes, eq(appearanceThemes.accountId, accountId))).toBe(2);

    const freshPreview = await previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file: packageFile,
    });
    const root = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "root" }]);
    const operationId = crypto.randomUUID();
    const confirmInput = {
      operationId,
      holderToken: TOKEN_A,
      handle: root[0],
      payloadDigest: freshPreview.payloadDigest,
      expectedStateRevision: freshPreview.expectedStateRevision,
    };
    const restored = await confirmAppearanceRestore(accountId, freshPreview.planId, confirmInput);
    expect(restored.snapshot.config.mode).toBe(packageFile.config.mode);
    const storedThemes = await getDb()
      .select({ name: appearanceThemes.name })
      .from(appearanceThemes)
      .where(eq(appearanceThemes.accountId, accountId));
    expect(storedThemes).toEqual([{ name: kept.theme.name }]);
    expect(await getDb().$count(appearanceThemeDrafts, eq(appearanceThemeDrafts.accountId, accountId))).toBe(0);

    const replay = await confirmAppearanceRestore(accountId, freshPreview.planId, confirmInput);
    expect(replay.snapshot.stateRevision).toBe(restored.snapshot.stateRevision);
    expect(await getDb().$count(appearanceThemes, eq(appearanceThemes.accountId, accountId))).toBe(1);
  });

  it("rolls back every live restore change when a bulk insert fails", async () => {
    await createTheme("Rollback first");
    await createTheme("Rollback second");
    const originalSnapshot = await getAppearanceSnapshot(accountId);
    const base = await exportAppearancePackage(accountId);
    const themeCount = APPEARANCE_TECHNICAL_LIMITS.restoreInsertBatch + 1;
    const themes = Array.from({ length: themeCount }, (_, index) => ({
      portableId: crypto.randomUUID(),
      name: `Rollback replacement ${String(index).padStart(3, "0")}`,
      declaredScheme: "light" as const,
      tokenContractVersion: 1 as const,
      tokens: BUILTIN_THEMES.light.tokens,
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
    }));
    const packageFile = appearancePackageV1Schema.parse({ ...base, themes });
    const preview = await previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file: packageFile,
    });
    await getDb().execute(sql.raw(`
      create function appearance_restore_failure_test() returns trigger
      language plpgsql as $$
      begin
        if new.name = 'Rollback replacement ${String(themeCount - 1).padStart(3, "0")}' then
          raise exception 'injected later-batch restore insert failure';
        end if;
        return new;
      end;
      $$
    `));
    await getDb().execute(sql.raw(`
      create trigger appearance_restore_failure_test
      before insert on appearance_themes
      for each row execute function appearance_restore_failure_test()
    `));
    const root = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "root" }]);
    try {
      await expect(confirmAppearanceRestore(accountId, preview.planId, {
        operationId: crypto.randomUUID(),
        holderToken: TOKEN_A,
        handle: root[0],
        payloadDigest: preview.payloadDigest,
        expectedStateRevision: preview.expectedStateRevision,
      })).rejects.toBeDefined();
    } finally {
      await getDb().execute(sql.raw("drop trigger if exists appearance_restore_failure_test on appearance_themes"));
      await getDb().execute(sql.raw("drop function if exists appearance_restore_failure_test()"));
    }

    const remaining = await getDb()
      .select({ name: appearanceThemes.name })
      .from(appearanceThemes)
      .where(eq(appearanceThemes.accountId, accountId));
    expect(remaining.map((theme) => theme.name).sort()).toEqual(["Rollback first", "Rollback second"]);
    expect((await getAppearanceSnapshot(accountId)).config).toEqual(originalSnapshot.config);
    await releaseAppearanceLeases(accountId, TOKEN_A, root);
  });

  it("rolls back restore after every theme insert when the config write fails", async () => {
    await createTheme("Config rollback first");
    await createTheme("Config rollback second");
    const originalSnapshot = await getAppearanceSnapshot(accountId);
    const base = await exportAppearancePackage(accountId);
    const packageFile = appearancePackageV1Schema.parse({
      ...base,
      config: { ...base.config, mode: "dark" },
      themes: [{
        portableId: crypto.randomUUID(),
        name: "Config write replacement",
        declaredScheme: "light",
        tokenContractVersion: 1,
        tokens: BUILTIN_THEMES.light.tokens,
        validationCanvas: BUILTIN_THEMES.light.validationCanvas,
        browserValidation: null,
      }],
    });
    const preview = await previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file: packageFile,
    });
    await getDb().execute(sql.raw(`
      create function appearance_restore_config_failure_test() returns trigger
      language plpgsql as $$
      begin
        if new.mode = 'dark' then
          raise exception 'injected final restore config failure';
        end if;
        return new;
      end;
      $$
    `));
    await getDb().execute(sql.raw(`
      create trigger appearance_restore_config_failure_test
      before update on appearance_configs
      for each row execute function appearance_restore_config_failure_test()
    `));
    const root = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "root" }]);
    try {
      await expect(confirmAppearanceRestore(accountId, preview.planId, {
        operationId: crypto.randomUUID(),
        holderToken: TOKEN_A,
        handle: root[0],
        payloadDigest: preview.payloadDigest,
        expectedStateRevision: preview.expectedStateRevision,
      })).rejects.toBeDefined();
    } finally {
      await getDb().execute(sql.raw("drop trigger if exists appearance_restore_config_failure_test on appearance_configs"));
      await getDb().execute(sql.raw("drop function if exists appearance_restore_config_failure_test()"));
    }

    const remaining = await getDb()
      .select({ name: appearanceThemes.name })
      .from(appearanceThemes)
      .where(eq(appearanceThemes.accountId, accountId));
    expect(remaining.map((theme) => theme.name).sort()).toEqual([
      "Config rollback first",
      "Config rollback second",
    ]);
    expect((await getAppearanceSnapshot(accountId)).config).toEqual(originalSnapshot.config);
    await releaseAppearanceLeases(accountId, TOKEN_A, root);
  });

  it("keeps theme reads, slots, and lease acquisition account-scoped", async () => {
    const created = await createTheme("Account scoped");
    const otherAccountId = await createAccount();
    try {
      await expect(getAppearanceTheme(otherAccountId, created.theme.id))
        .rejects.toMatchObject({ code: "APPEARANCE_NOT_FOUND" });
      await expect(mutateAppearanceConfig(otherAccountId, {
        action: "set-slot",
        operationId: crypto.randomUUID(),
        holderToken: TOKEN_B,
        scheme: "light",
        selector: { kind: "custom", themeId: created.theme.id },
      })).rejects.toMatchObject({ code: "APPEARANCE_NOT_FOUND" });
      await expect(acquireAppearanceLeases(otherAccountId, TOKEN_B, [{ kind: "theme", themeId: created.theme.id }]))
        .rejects.toMatchObject({ code: "APPEARANCE_NOT_FOUND" });
    } finally {
      await getDb().delete(users).where(eq(users.id, otherAccountId));
    }
  });

  it("cascades a complete appearance account even when both slots reference custom themes", async () => {
    const extraAccountId = await createAccount();
    const createForExtra = async (name: string, scheme: "light" | "dark") => {
      const result = await createAppearanceTheme(extraAccountId, {
        operationId: crypto.randomUUID(),
        holderToken: TOKEN_A,
        name,
        declaredScheme: scheme,
        source: { kind: "builtin", scheme },
        validationCanvas: BUILTIN_THEMES[scheme].validationCanvas,
        browserValidation: null,
        keepLease: false,
      });
      if ("kind" in result) throw new Error("New extra-account create unexpectedly replayed a receipt.");
      return result;
    };
    const light = await createForExtra("Account delete light", "light");
    const dark = await createForExtra("Account delete dark", "dark");
    await mutateAppearanceConfig(extraAccountId, {
      action: "set-slot", operationId: crypto.randomUUID(), holderToken: TOKEN_A,
      scheme: "light", selector: { kind: "custom", themeId: light.theme.id },
    });
    await mutateAppearanceConfig(extraAccountId, {
      action: "set-slot", operationId: crypto.randomUUID(), holderToken: TOKEN_A,
      scheme: "dark", selector: { kind: "custom", themeId: dark.theme.id },
    });

    await expect(getDb().delete(users).where(eq(users.id, extraAccountId))).resolves.toBeDefined();
    expect(await getDb().$count(appearanceThemes, eq(appearanceThemes.accountId, extraAccountId))).toBe(0);
    expect(await getDb().$count(appearanceLockState, eq(appearanceLockState.accountId, extraAccountId))).toBe(0);
  });

  it("exports more than one page without duplicate or missing themes", async () => {
    const rows = Array.from({ length: APPEARANCE_TECHNICAL_LIMITS.listMaximum + 1 }, (_, index) => ({
      id: crypto.randomUUID(),
      accountId,
      name: `Bulk export ${String(index).padStart(3, "0")}`,
      declaredScheme: "light" as const,
      contractVersion: 1,
      tokens: BUILTIN_THEMES.light.tokens,
      validationCanvasColor: BUILTIN_THEMES.light.validationCanvas.color,
      browserValidation: null,
      themeRevision: 1n,
    }));
    await getDb().insert(appearanceThemes).values(rows);
    await getDb().insert(appearanceLeases).values(rows.map((theme) => ({
      accountId,
      resourceKind: "theme" as const,
      themeId: theme.id,
    })));

    const exported = await exportAppearancePackage(accountId);
    expect(exported.themes).toHaveLength(rows.length);
    expect(new Set(exported.themes.map((theme) => theme.name)).size).toBe(rows.length);
  });

  it("restores more than one insert batch atomically", async () => {
    const base = await exportAppearancePackage(accountId);
    const themeCount = APPEARANCE_TECHNICAL_LIMITS.restoreInsertBatch + 1;
    const themes = Array.from({ length: themeCount }, (_, index) => ({
      portableId: crypto.randomUUID(),
      name: `Restore batch ${String(index).padStart(3, "0")}`,
      declaredScheme: "light" as const,
      tokenContractVersion: 1 as const,
      tokens: BUILTIN_THEMES.light.tokens,
      validationCanvas: BUILTIN_THEMES.light.validationCanvas,
      browserValidation: null,
    }));
    const file = appearancePackageV1Schema.parse({ ...base, themes });
    const preview = await previewAppearanceRestore(accountId, {
      operationId: crypto.randomUUID(),
      file,
    });
    const [root] = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "root" }]);
    if (!root) throw new Error("Expected restore root lease.");
    const restored = await confirmAppearanceRestore(accountId, preview.planId, {
      operationId: crypto.randomUUID(),
      holderToken: TOKEN_A,
      handle: root,
      payloadDigest: preview.payloadDigest,
      expectedStateRevision: preview.expectedStateRevision,
    });

    expect(restored.snapshot.stateRevision).toBe("1");
    expect(await getDb().$count(appearanceThemes, eq(appearanceThemes.accountId, accountId))).toBe(themeCount);
    expect(await getDb().$count(appearanceLeases, and(
      eq(appearanceLeases.accountId, accountId),
      eq(appearanceLeases.resourceKind, "theme"),
    ))).toBe(themeCount);
  });

  it("exports only formal portable state and never account/draft/lease metadata", async () => {
    const created = await createTheme("Portable");
    const [handle] = await acquireAppearanceLeases(accountId, TOKEN_A, [{ kind: "theme", themeId: created.theme.id }]);
    if (!handle) throw new Error("Expected handle.");
    const invalidTokens = cloneThemeTokens(created.theme.tokens);
    invalidTokens.foreground = { expression: "transparent", fallback: "#00000000" };
    await autosaveAppearanceTheme(accountId, created.theme.id, {
      operationId: crypto.randomUUID(), holderToken: TOKEN_A, handle,
      expectedThemeRevision: created.theme.themeRevision, expectedDraftRevision: null,
      snapshot: { contractVersion: 1, tokens: invalidTokens, validationCanvas: created.theme.validationCanvas, browserValidation: null },
    });
    const exported = await exportAppearancePackage(accountId);
    const serialized = JSON.stringify(exported);
    expect(exported.themes[0]?.portableId).toBe("theme-1");
    expect(serialized).not.toContain(accountId);
    expect(serialized).not.toMatch(/draftRevision|holderToken|leaseId|stateRevision|username/);
    expect(exported.themes[0]?.tokens.foreground).toEqual(created.theme.tokens.foreground);

    const download = await prepareAppearancePackageDownload(accountId);
    expect(download.contentLength).toBe(Buffer.byteLength(serialized, "utf8"));
    const streamed = appearancePackageV1Schema.parse(await new Response(download.body).json());
    expect(streamed).toEqual(exported);
  });

  it("cancels package export after the first page and releases the read transaction", async () => {
    const rows = Array.from({ length: APPEARANCE_TECHNICAL_LIMITS.listMaximum + 1 }, (_, index) => ({
      id: crypto.randomUUID(),
      accountId,
      name: `Cancelled export ${String(index).padStart(3, "0")}`,
      declaredScheme: "light" as const,
      contractVersion: 1,
      tokens: BUILTIN_THEMES.light.tokens,
      validationCanvasColor: BUILTIN_THEMES.light.validationCanvas.color,
      browserValidation: null,
      themeRevision: 1n,
    }));
    await getDb().insert(appearanceThemes).values(rows);
    await getDb().insert(appearanceLeases).values(rows.map((theme) => ({
      accountId,
      resourceKind: "theme" as const,
      themeId: theme.id,
    })));

    let abortChecks = 0;
    const signal = {
      get aborted() {
        abortChecks += 1;
        return abortChecks > APPEARANCE_TECHNICAL_LIMITS.listMaximum + 3;
      },
    } as unknown as AbortSignal;

    await expect(prepareAppearancePackageDownload(accountId, signal)).rejects.toMatchObject({
      code: "APPEARANCE_BUSY",
    });
    expect(abortChecks).toBeGreaterThan(APPEARANCE_TECHNICAL_LIMITS.listMaximum + 3);
    await expect(getDb().execute(sql`select 1 as healthy`)).resolves.toBeDefined();
  });
});
