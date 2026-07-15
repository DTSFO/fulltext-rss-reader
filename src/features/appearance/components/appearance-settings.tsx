"use client";

import {
  Check,
  ChevronLeft,
  Copy,
  Download,
  Edit3,
  FileJson,
  LoaderCircle,
  Palette,
  Plus,
  RefreshCw,
  Shield,
  TextCursorInput,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

import {
  appearanceMutationRequest,
  downloadBlob,
  downloadJson,
  mutateConfig,
} from "@/features/appearance/appearance-client";
import { useAppearance } from "@/features/appearance/components/appearance-provider";
import { ModalDialog } from "@/features/appearance/components/modal-dialog";
import {
  RenameThemeDialog,
  ThemeImpactDialog,
} from "@/features/appearance/components/theme-action-dialogs";
import {
  ResetThemeDialog,
  SearchableThemePicker,
  type ThemePickerSelection,
} from "@/features/appearance/components/searchable-theme-picker";
import { ThemeEditor } from "@/features/appearance/components/theme-editor";
import { useAppearanceLease } from "@/features/appearance/hooks/use-appearance-lease";
import {
  appearancePackageV1Schema,
  configMutationDataSchema,
  createThemeDataSchema,
  createThemeInputSchema,
  declaredSchemeSchema,
  importThemeInputSchema,
  restoreConfirmInputSchema,
  restorePreviewDataSchema,
  restorePreviewInputSchema,
  recoveryShortcutSchema,
  themeDetailDataSchema,
  themeFileV1Schema,
  themeImpactSchema,
  themeListDataSchema,
  themeMutationDataSchema,
  type LeaseHandle,
  type StoredTheme,
} from "@/features/appearance/schemas/appearance-schema";
import {
  buildBrowserValidationReport,
  captureBrowserCanvas,
} from "@/features/appearance/runtime/theme-runtime";
import {
  BUILTIN_THEMES,
  SHORTCUT_CONFLICT_TABLE_VERSION,
  type AppearanceMode,
  type AppearanceSnapshot,
  type DeclaredScheme,
  type ThemeSelector,
  type ThemeTokenMap,
} from "@/features/appearance/theme-contract";
import {
  BrowserApiError,
  browserApiRequest,
  browserFileRequest,
  browserJsonFileRequest,
} from "@/lib/api/browser-api";

type ThemeSummary = z.infer<typeof themeListDataSchema>["items"][number];
type Status = { kind: "idle" | "saving" | "saved" | "error" | "conflict"; message: string };
type RestorePreview = Awaited<ReturnType<typeof previewPackage>>;
type ThemeImpact = z.infer<typeof themeImpactSchema>;
type ThemeBrowserContext = Awaited<ReturnType<typeof browserContextForTheme>>;
type SchemeChangePlan = {
  theme: ThemeSummary;
  newScheme: DeclaredScheme;
  resolvedSystemScheme: DeclaredScheme;
  impact: ThemeImpact;
  context: ThemeBrowserContext;
};
type ShortcutDraft = {
  code: string;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  shift: boolean;
};

function scopeElement(): HTMLElement {
  const scope = document.getElementById("account-appearance-scope");
  if (!scope) throw new Error("外观作用域不存在。");
  return scope;
}

async function readJsonFile(file: File, maximumBytes: number): Promise<unknown> {
  if (file.size > maximumBytes) {
    throw new Error("所选文件超过部署导入技术限制。");
  }
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return parsed;
  } catch {
    throw new Error("所选文件不是有效的 JSON。请检查文件内容后重试。");
  }
}

function boundedRequestBody(value: unknown, maximumBytes: number): string {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new Error("文件加入当前浏览器验证报告后超过部署导入技术限制。");
  }
  return body;
}

async function themePayloadFromSource(
  source: { kind: "builtin"; scheme: DeclaredScheme } | { kind: "custom"; themeId: string },
): Promise<{ tokens: ThemeTokenMap; expectedThemeRevision?: string }> {
  if (source.kind === "builtin") return { tokens: BUILTIN_THEMES[source.scheme].tokens };
  const detail = await browserApiRequest(`/api/appearance/themes/${source.themeId}`, themeDetailDataSchema);
  return { tokens: detail.theme.tokens, expectedThemeRevision: detail.theme.themeRevision };
}

async function browserContextForTheme(tokens: ThemeTokenMap, scheme: DeclaredScheme, portableCanvas?: string) {
  const scope = scopeElement();
  const canvasColor = portableCanvas ?? captureBrowserCanvas(scope, scheme);
  if (!canvasColor) throw new Error("当前浏览器无法采集不透明 Canvas 系统色。");
  const validationCanvas = { color: canvasColor, source: "browser-canvas" as const };
  const browserValidation = await buildBrowserValidationReport(scope, { tokens, validationCanvas }, scheme);
  return { validationCanvas, browserValidation };
}

function pickerSelection(
  selector: ThemeSelector,
  scheme: DeclaredScheme,
  appliedTheme: { name: string; declaredScheme: DeclaredScheme },
): ThemePickerSelection {
  return selector.kind === "custom"
    ? { kind: "custom", themeId: selector.themeId, name: appliedTheme.name, declaredScheme: appliedTheme.declaredScheme }
    : { kind: "builtin", scheme };
}

function fileName(name: string): string {
  return name.trim().replaceAll(/[^\p{L}\p{N}._-]+/gu, "-").replaceAll(/^-|-$/g, "") || "theme";
}

function modeLabel(mode: AppearanceMode): string {
  return mode === "light" ? "明亮" : mode === "dark" ? "暗色" : "跟随系统";
}

function themeUsageLabels(
  themeId: string,
  snapshot: AppearanceSnapshot,
  resolvedScheme: DeclaredScheme,
): string[] {
  const labels: string[] = [];
  const activeSelector = resolvedScheme === "light" ? snapshot.config.lightTheme : snapshot.config.darkTheme;
  if (activeSelector.kind === "custom" && activeSelector.themeId === themeId) labels.push("当前生效");
  if (snapshot.config.lightTheme.kind === "custom" && snapshot.config.lightTheme.themeId === themeId) labels.push("明亮槽");
  if (snapshot.config.darkTheme.kind === "custom" && snapshot.config.darkTheme.themeId === themeId) labels.push("暗色槽");
  return labels;
}

async function previewPackage(fileValue: unknown, maximumRequestBytes: number) {
  const parsed = appearancePackageV1Schema.safeParse(fileValue);
  if (!parsed.success) {
    throw new Error("整包备份的格式、版本或主题数据不受支持。");
  }
  const themes: typeof parsed.data.themes = [];
  for (const theme of parsed.data.themes) {
    const context = await browserContextForTheme(theme.tokens, theme.declaredScheme, theme.validationCanvas.color);
    themes.push({ ...theme, browserValidation: context.browserValidation });
  }
  const file = appearancePackageV1Schema.parse({ ...parsed.data, themes });
  const input = restorePreviewInputSchema.parse({
    operationId: crypto.randomUUID(),
    file,
  });
  return appearanceMutationRequest("/api/appearance/import/package/preview", restorePreviewDataSchema, {
    method: "POST",
    body: boundedRequestBody(input, maximumRequestBytes),
  });
}

export function AppearanceSettings({
  initialThemes,
  initialNextCursor,
  themeImportMaximumBytes,
  packageImportMaximumBytes,
}: {
  initialThemes: ThemeSummary[];
  initialNextCursor: string | null;
  themeImportMaximumBytes: number;
  packageImportMaximumBytes: number;
}) {
  const appearance = useAppearance();
  const operationLease = useAppearanceLease();
  const [themes, setThemes] = useState(initialThemes);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [search, setSearch] = useState("");
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [initialEditorHandle, setInitialEditorHandle] = useState<LeaseHandle | null>(null);
  const [initialEditorHolderToken, setInitialEditorHolderToken] = useState<string | undefined>();
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });
  const [createOpen, setCreateOpen] = useState(false);
  const [createSource, setCreateSource] = useState<ThemePickerSelection>({ kind: "builtin", scheme: "light" });
  const [renameTarget, setRenameTarget] = useState<ThemeSummary | null>(null);
  const [renameName, setRenameName] = useState("");
  const [schemeChangePlan, setSchemeChangePlan] = useState<SchemeChangePlan | null>(null);
  const [deletePlan, setDeletePlan] = useState<{ theme: ThemeSummary; impact: ThemeImpact } | null>(null);
  const [resetTarget, setResetTarget] = useState<ThemeSummary | null>(null);
  const [resetSource, setResetSource] = useState<ThemePickerSelection>({ kind: "builtin", scheme: "light" });
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutDraft | null>(null);
  const [escapeRecoveryDraft, setEscapeRecoveryDraft] = useState<boolean | null>(null);
  const persistedShortcut = appearance.snapshot.config.recoveryShortcut;
  const shortcutCode = shortcutDraft?.code ?? persistedShortcut?.code ?? "";
  const shortcutModifiers = {
    ctrl: shortcutDraft?.ctrl ?? persistedShortcut?.ctrl ?? false,
    alt: shortcutDraft?.alt ?? persistedShortcut?.alt ?? false,
    meta: shortcutDraft?.meta ?? persistedShortcut?.meta ?? false,
    shift: shortcutDraft?.shift ?? persistedShortcut?.shift ?? false,
  };
  const busy = status.kind === "saving";
  const themeImportRef = useRef<HTMLInputElement>(null);
  const packageImportRef = useRef<HTMLInputElement>(null);
  const configMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const configMutationGenerationRef = useRef(0);
  const configMutationPendingRef = useRef(0);
  const recoveryKeyboardIntentGenerationRef = useRef(0);
  const recoverySettingsIntentRef = useRef({
    recoveryShortcut: appearance.snapshot.config.recoveryShortcut,
    escapeRecoveryEnabled: appearance.snapshot.config.escapeRecoveryEnabled,
  });
  const actionsInFlightRef = useRef(new Set<string>());
  const themeListRequestSequenceRef = useRef(0);

  useEffect(() => {
    if (configMutationPendingRef.current > 0 || shortcutDraft) return;
    recoverySettingsIntentRef.current = {
      recoveryShortcut: appearance.snapshot.config.recoveryShortcut,
      escapeRecoveryEnabled: appearance.snapshot.config.escapeRecoveryEnabled,
    };
  }, [
    appearance.snapshot.config.escapeRecoveryEnabled,
    appearance.snapshot.config.recoveryShortcut,
    shortcutDraft,
  ]);

  useEffect(() => {
    if (!schemeChangePlan || appearance.snapshot.config.mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const invalidate = () => {
      setSchemeChangePlan(null);
      setStatus({ kind: "error", message: "确认期间系统颜色方案已变化，请重新查看迁移影响。" });
    };
    const currentScheme = media.matches ? "dark" : "light";
    if (currentScheme !== schemeChangePlan.resolvedSystemScheme) {
      invalidate();
      return;
    }
    media.addEventListener("change", invalidate);
    return () => media.removeEventListener("change", invalidate);
  }, [appearance.snapshot.config.mode, schemeChangePlan]);

  const showError = useCallback((caught: unknown) => {
    let message = caught instanceof Error ? caught.message : "外观操作失败。";
    if (
      caught instanceof BrowserApiError &&
      caught.code === "APPEARANCE_LEASE_CONFLICT" &&
      caught.details &&
      typeof caught.details === "object" &&
      !Array.isArray(caught.details)
    ) {
      const expiresAt = Reflect.get(caught.details, "expiresAt");
      if (typeof expiresAt === "string") {
        const expiry = new Date(expiresAt);
        if (!Number.isNaN(expiry.getTime())) {
          message = `${message} 当前租约最早于 ${expiry.toLocaleTimeString()} 到期，可再次确认重试。`;
        }
      }
    }
    setStatus({
      kind: caught instanceof BrowserApiError && caught.code === "APPEARANCE_LEASE_CONFLICT" ? "conflict" : "error",
      message: caught instanceof BrowserApiError && caught.requestId
        ? `${message}（请求编号：${caught.requestId}）`
        : message,
    });
  }, []);

  function updateConfig(input: Parameters<typeof mutateConfig>[0]): Promise<boolean> {
    configMutationGenerationRef.current += 1;
    configMutationPendingRef.current += 1;
    const generation = configMutationGenerationRef.current;
    setStatus({ kind: "saving", message: "正在保存外观配置…" });
    const execute = async () => {
      try {
        const snapshot = await mutateConfig(input);
        appearance.updateSnapshot(snapshot);
        if (generation === configMutationGenerationRef.current) {
          setStatus({ kind: "saved", message: "配置已保存" });
        }
        return true;
      } catch (caught) {
        if (generation === configMutationGenerationRef.current) showError(caught);
        return false;
      } finally {
        configMutationPendingRef.current -= 1;
      }
    };
    const queued = configMutationTailRef.current.then(execute, execute);
    configMutationTailRef.current = queued.then(() => undefined);
    return queued;
  }

  function beginExclusiveAction(key: string): boolean {
    if (actionsInFlightRef.current.has(key)) return false;
    actionsInFlightRef.current.add(key);
    return true;
  }

  function endExclusiveAction(key: string): void {
    actionsInFlightRef.current.delete(key);
  }

  async function setMode(mode: AppearanceMode) {
    await updateConfig({
      action: "set-mode",
      operationId: crypto.randomUUID(),
      holderToken: operationLease.holderToken,
      mode,
    });
  }

  async function setSlot(scheme: DeclaredScheme, selection: ThemePickerSelection) {
    if (selection.kind === "custom" && selection.declaredScheme !== scheme) {
      throw new Error("槽位只能选择同类型主题。");
    }
    await updateConfig({
      action: "set-slot",
      operationId: crypto.randomUUID(),
      holderToken: operationLease.holderToken,
      scheme,
      selector: selection.kind === "builtin"
        ? { kind: "builtin" }
        : { kind: "custom", themeId: selection.themeId },
    });
  }

  async function applyTheme(themeId: string) {
    await updateConfig({
      action: "apply-theme",
      operationId: crypto.randomUUID(),
      holderToken: operationLease.holderToken,
      themeId,
    });
  }

  function openDraftResolution(theme: ThemeSummary): boolean {
    if (!theme.hasDraft) return false;
    setInitialEditorHandle(null);
    setInitialEditorHolderToken(undefined);
    setSelectedThemeId(theme.id);
    return true;
  }

  async function openAcquiredDraftResolution(
    theme: ThemeSummary,
    handles: LeaseHandle[],
  ): Promise<boolean> {
    const requiresResolution = handles.some(
      (handle) =>
        handle.resource.kind === "theme" &&
        handle.resource.themeId === theme.id &&
        handle.requiresDraftResolution,
    );
    if (!requiresResolution) return false;
    await operationLease.release(handles);
    setRenameTarget(null);
    setResetTarget(null);
    setSchemeChangePlan(null);
    setInitialEditorHandle(null);
    setInitialEditorHolderToken(undefined);
    setStatus({ kind: "idle", message: "" });
    setSelectedThemeId(theme.id);
    return true;
  }

  const refreshThemes = useCallback(async (query = search) => {
    const sequence = ++themeListRequestSequenceRef.current;
    const params = new URLSearchParams();
    if (query.trim()) params.set("query", query.trim());
    const page = await browserApiRequest(`/api/appearance/themes?${params}`, themeListDataSchema);
    if (sequence !== themeListRequestSequenceRef.current) return;
    setThemes(page.items);
    setNextCursor(page.nextCursor);
  }, [search]);

  useEffect(() => {
    const refresh = () => {
      void refreshThemes().catch(showError);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [refreshThemes, showError]);

  async function loadMore() {
    if (!nextCursor) return;
    const sequence = ++themeListRequestSequenceRef.current;
    const params = new URLSearchParams({ cursor: nextCursor });
    if (search.trim()) params.set("query", search.trim());
    const page = await browserApiRequest(`/api/appearance/themes?${params}`, themeListDataSchema);
    if (sequence !== themeListRequestSequenceRef.current) return;
    setThemes((current) => [...current, ...page.items]);
    setNextCursor(page.nextCursor);
  }

  async function createTheme(form: HTMLFormElement) {
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const declaredScheme = declaredSchemeSchema.parse(formData.get("scheme"));
    const source = createSource.kind === "builtin"
      ? createSource
      : { kind: "custom" as const, themeId: createSource.themeId };
    if (!beginExclusiveAction("create-theme")) return;
    setStatus({ kind: "saving", message: "正在创建主题…" });
    try {
      const sourcePayload = await themePayloadFromSource(source);
      const context = await browserContextForTheme(sourcePayload.tokens, declaredScheme);
      const input = createThemeInputSchema.parse({
        operationId: crypto.randomUUID(),
        holderToken: operationLease.holderToken,
        name,
        declaredScheme,
        source:
          source.kind === "builtin"
            ? source
            : { ...source, expectedThemeRevision: sourcePayload.expectedThemeRevision },
        ...context,
        keepLease: true,
      });
      const data = await appearanceMutationRequest("/api/appearance/themes", createThemeDataSchema, {
        method: "POST",
        body: JSON.stringify(input),
      });
      appearance.updateSnapshot(data.snapshot);
      await refreshThemes("");
      setCreateOpen(false);
      if ("kind" in data) {
        operationLease.adopt([]);
        setStatus({ kind: "saved", message: "创建请求此前已完成；该主题当前已不存在" });
        return;
      }
      setInitialEditorHandle(data.handle);
      setInitialEditorHolderToken(operationLease.holderToken);
      operationLease.adopt([]);
      setSelectedThemeId(data.theme.id);
      setStatus({ kind: "saved", message: "主题已创建" });
    } catch (caught) {
      showError(caught);
    } finally {
      endExclusiveAction("create-theme");
    }
  }

  async function duplicateTheme(theme: ThemeSummary) {
    setStatus({ kind: "saving", message: "正在复制主题…" });
    try {
      const sourcePayload = await themePayloadFromSource({ kind: "custom", themeId: theme.id });
      const context = await browserContextForTheme(sourcePayload.tokens, theme.declaredScheme);
      const data = await appearanceMutationRequest("/api/appearance/themes", createThemeDataSchema, {
        method: "POST",
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          holderToken: operationLease.holderToken,
          name: `${theme.name} 副本`,
          declaredScheme: theme.declaredScheme,
          source: { kind: "custom", themeId: theme.id, expectedThemeRevision: sourcePayload.expectedThemeRevision },
          ...context,
          keepLease: false,
        }),
      });
      appearance.updateSnapshot(data.snapshot);
      await refreshThemes();
      setStatus({
        kind: "saved",
        message: "kind" in data ? "复制请求此前已完成；该主题当前已不存在" : "主题已复制",
      });
    } catch (caught) {
      showError(caught);
    }
  }

  async function renameTheme() {
    const theme = renameTarget;
    const name = renameName.trim();
    if (!theme) return;
    if (!name) {
      setStatus({ kind: "error", message: "主题名称不能为空。" });
      return;
    }
    if (name === theme.name) {
      setRenameTarget(null);
      return;
    }
    setStatus({ kind: "saving", message: "正在重命名主题…" });
    const handles = await operationLease.acquire([{ kind: "theme", themeId: theme.id }]);
    if (handles.length === 0) return showError(operationLease.currentError() ?? new Error("无法取得主题租约。"));
    if (await openAcquiredDraftResolution(theme, handles)) return;
    try {
      const data = await appearanceMutationRequest(`/api/appearance/themes/${theme.id}`, themeMutationDataSchema, {
        method: "PATCH",
        body: JSON.stringify({
          action: "rename",
          operationId: crypto.randomUUID(),
          holderToken: operationLease.holderToken,
          handles,
          expectedStateRevision: appearance.snapshot.stateRevision,
          name,
        }),
      });
      appearance.updateSnapshot(data.snapshot);
      await refreshThemes();
      setRenameTarget(null);
      setStatus({ kind: "saved", message: "主题已重命名" });
    } catch (caught) {
      showError(caught);
    } finally {
      await operationLease.release(handles);
    }
  }

  function openResetTheme(theme: ThemeSummary) {
    if (openDraftResolution(theme)) return;
    setResetTarget(theme);
    setResetSource({ kind: "builtin", scheme: theme.declaredScheme });
  }

  async function resetTheme() {
    const theme = resetTarget;
    if (!theme) return;
    if (!beginExclusiveAction("reset-theme")) return;
    try {
      setStatus({ kind: "saving", message: "正在重置主题…" });
      const source = resetSource.kind === "builtin"
        ? resetSource
        : { kind: "custom" as const, themeId: resetSource.themeId };
      const handles = await operationLease.acquire([{ kind: "theme", themeId: theme.id }]);
      if (handles.length === 0) {
        showError(operationLease.currentError() ?? new Error("无法取得主题租约。"));
        return;
      }
      if (await openAcquiredDraftResolution(theme, handles)) return;
      try {
        const sourcePayload = await themePayloadFromSource(source);
        const context = await browserContextForTheme(sourcePayload.tokens, theme.declaredScheme);
        const detail = await browserApiRequest(`/api/appearance/themes/${theme.id}`, themeDetailDataSchema);
        const data = await appearanceMutationRequest(`/api/appearance/themes/${theme.id}/reset`, themeMutationDataSchema, {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            holderToken: operationLease.holderToken,
            handle: handles[0],
            expectedThemeRevision: detail.theme.themeRevision,
            source: source.kind === "builtin"
              ? source
              : { ...source, expectedThemeRevision: sourcePayload.expectedThemeRevision },
            ...context,
          }),
        });
        if (data.snapshot) appearance.updateSnapshot(data.snapshot);
        await refreshThemes();
        setResetTarget(null);
        setStatus({ kind: "saved", message: "主题已重置" });
      } catch (caught) {
        showError(caught);
      } finally {
        await operationLease.release(handles);
      }
    } finally {
      endExclusiveAction("reset-theme");
    }
  }

  async function changeThemeScheme(theme: ThemeSummary) {
    if (openDraftResolution(theme)) return;
    const newScheme: DeclaredScheme = theme.declaredScheme === "light" ? "dark" : "light";
    const resolvedSystemScheme = appearance.resolvedScheme;
    setStatus({ kind: "saving", message: "正在计算类型迁移影响…" });
    try {
      const detail = await browserApiRequest(`/api/appearance/themes/${theme.id}`, themeDetailDataSchema);
      const context = await browserContextForTheme(detail.theme.tokens, newScheme);
      const query = new URLSearchParams({
        action: "change-scheme",
        scheme: newScheme,
        resolvedSystemScheme,
        canvas: context.validationCanvas.color,
      });
      const impact = await browserApiRequest(`/api/appearance/themes/${theme.id}/impact?${query}`, themeImpactSchema);
      setSchemeChangePlan({ theme, newScheme, resolvedSystemScheme, impact, context });
      setStatus({ kind: "idle", message: "" });
    } catch (caught) {
      showError(caught);
    }
  }

  async function confirmThemeSchemeChange() {
    const plan = schemeChangePlan;
    if (!plan) return;
    if (appearance.resolvedScheme !== plan.resolvedSystemScheme) {
      setSchemeChangePlan(null);
      setStatus({ kind: "error", message: "确认期间系统颜色方案已变化，请重新查看迁移影响。" });
      return;
    }
    setStatus({ kind: "saving", message: "正在迁移主题类型…" });
    const handles = await operationLease.acquire([
      { kind: "config" },
      { kind: "theme", themeId: plan.theme.id },
    ]);
    if (handles.length !== 2) return showError(operationLease.currentError() ?? new Error("无法取得完整租约集合。"));
    if (await openAcquiredDraftResolution(plan.theme, handles)) return;
    try {
      const data = await appearanceMutationRequest(`/api/appearance/themes/${plan.theme.id}`, themeMutationDataSchema, {
        method: "PATCH",
        body: JSON.stringify({
          action: "change-scheme",
          operationId: crypto.randomUUID(),
          holderToken: operationLease.holderToken,
          handles,
          expectedStateRevision: plan.impact.stateRevision,
          declaredScheme: plan.newScheme,
          resolvedSystemSchemeAtConfirmation: plan.resolvedSystemScheme,
          validationCanvas: plan.context.validationCanvas,
          browserValidation: plan.context.browserValidation,
          impactDigest: plan.impact.impactDigest,
        }),
      });
      appearance.updateSnapshot(data.snapshot);
      await refreshThemes();
      setSchemeChangePlan(null);
      setStatus({ kind: "saved", message: "主题类型已迁移" });
    } catch (caught) {
      showError(caught);
    } finally {
      await operationLease.release(handles);
    }
  }

  async function deleteTheme(theme: ThemeSummary) {
    setStatus({ kind: "saving", message: "正在计算删除影响…" });
    try {
      const impact = await browserApiRequest(`/api/appearance/themes/${theme.id}/impact?action=delete`, themeImpactSchema);
      setDeletePlan({ theme, impact });
      setStatus({ kind: "idle", message: "" });
    } catch (caught) {
      showError(caught);
    }
  }

  async function confirmDeleteTheme() {
    const plan = deletePlan;
    if (!plan) return;
    setStatus({ kind: "saving", message: "正在删除主题…" });
    const handles = await operationLease.acquire([
      { kind: "config" },
      { kind: "theme", themeId: plan.theme.id },
    ]);
    if (handles.length !== 2) return showError(operationLease.currentError() ?? new Error("无法取得完整租约集合。"));
    try {
      const data = await appearanceMutationRequest(`/api/appearance/themes/${plan.theme.id}`, themeMutationDataSchema, {
        method: "DELETE",
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          holderToken: operationLease.holderToken,
          handles,
          expectedStateRevision: plan.impact.stateRevision,
          impactDigest: plan.impact.impactDigest,
          discardDraft: true,
        }),
      });
      appearance.updateSnapshot(data.snapshot);
      if (selectedThemeId === plan.theme.id) setSelectedThemeId(null);
      await refreshThemes();
      setDeletePlan(null);
      setStatus({ kind: "saved", message: "主题已删除" });
    } catch (caught) {
      showError(caught);
    } finally {
      // Deletion cascades the theme lease; delayed release is safely fenced.
      await operationLease.release(handles);
    }
  }

  async function exportTheme(theme: ThemeSummary) {
    const file = await browserJsonFileRequest(
      `/api/appearance/export/theme/${theme.id}`,
      themeFileV1Schema,
    );
    downloadJson(`fulltext-rss-reader-theme-${fileName(theme.name)}.json`, file);
  }

  async function importTheme(file: File) {
    setStatus({ kind: "saving", message: "正在导入主题…" });
    try {
      const parsedResult = themeFileV1Schema.safeParse(await readJsonFile(file, themeImportMaximumBytes));
      if (!parsedResult.success) {
        throw new Error("单主题文件的格式、版本或颜色数据不受支持。");
      }
      const parsed = parsedResult.data;
      const context = await browserContextForTheme(
        parsed.theme.tokens,
        parsed.theme.declaredScheme,
        parsed.theme.validationCanvas.color,
      );
      const input = importThemeInputSchema.parse({
        operationId: crypto.randomUUID(),
        holderToken: operationLease.holderToken,
        file: themeFileV1Schema.parse({
          ...parsed,
          theme: { ...parsed.theme, browserValidation: context.browserValidation },
        }),
        editAfterImport: false,
      });
      const data = await appearanceMutationRequest("/api/appearance/import/theme", createThemeDataSchema, {
        method: "POST",
        body: boundedRequestBody(input, themeImportMaximumBytes),
      });
      appearance.updateSnapshot(data.snapshot);
      await refreshThemes();
      setStatus({
        kind: "saved",
        message: "kind" in data ? "导入请求此前已完成；该主题当前已不存在" : "主题已导入",
      });
    } catch (caught) {
      showError(caught);
    }
  }

  async function exportPackage() {
    const file = await browserFileRequest("/api/appearance/export/package");
    downloadBlob("fulltext-rss-reader-appearance-v1.json", file);
  }

  async function preparePackage(file: File) {
    try {
      setStatus({ kind: "saving", message: "正在完整校验恢复文件…" });
      const preview = await previewPackage(
        await readJsonFile(file, packageImportMaximumBytes),
        packageImportMaximumBytes,
      );
      setRestorePreview(preview);
      setStatus({ kind: "idle", message: "" });
    } catch (caught) {
      showError(caught);
    }
  }

  async function confirmRestore() {
    if (!restorePreview) return;
    if (!beginExclusiveAction("restore-package")) return;
    try {
      setStatus({ kind: "saving", message: "正在恢复账户外观…" });
      const handles = await operationLease.acquire([{ kind: "root" }]);
      const handle = handles[0];
      if (!handle) {
        showError(operationLease.currentError() ?? new Error("存在有效子租约，无法取得账户根租约。"));
        return;
      }
      let applied = false;
      try {
        const input = restoreConfirmInputSchema.parse({
          operationId: crypto.randomUUID(),
          holderToken: operationLease.holderToken,
          handle,
          payloadDigest: restorePreview.payloadDigest,
          expectedStateRevision: restorePreview.expectedStateRevision,
        });
        const data = await appearanceMutationRequest(
          `/api/appearance/import/package/${restorePreview.planId}/confirm`,
          configMutationDataSchema,
          { method: "POST", body: JSON.stringify(input) },
        );
        applied = true;
        operationLease.adopt([]);
        appearance.updateSnapshot(data.snapshot);
        setRestorePreview(null);
        await refreshThemes("");
        setStatus({ kind: "saved", message: "整包恢复完成" });
      } catch (caught) {
        showError(caught);
      } finally {
        if (!applied) await operationLease.release(handles);
      }
    } finally {
      endExclusiveAction("restore-package");
    }
  }

  async function saveRecoverySettings(draft = shortcutDraft) {
    const code = draft?.code ?? shortcutCode;
    const modifiers = draft ?? shortcutModifiers;
    const shortcut = code
      ? {
          code,
          ctrl: modifiers.ctrl,
          alt: modifiers.alt,
          meta: modifiers.meta,
          shift: modifiers.shift,
          conflictTableVersion: SHORTCUT_CONFLICT_TABLE_VERSION,
        }
      : null;
    const nextSettings = {
      recoveryShortcut: shortcut,
      escapeRecoveryEnabled: recoverySettingsIntentRef.current.escapeRecoveryEnabled,
    };
    recoverySettingsIntentRef.current = nextSettings;
    const intentGeneration = ++recoveryKeyboardIntentGenerationRef.current;
    appearance.setRecoveryKeyboardIntent({
      shortcut: nextSettings.recoveryShortcut,
      escapeEnabled: nextSettings.escapeRecoveryEnabled,
    });
    const saved = await updateConfig({
      action: "set-recovery",
      operationId: crypto.randomUUID(),
      holderToken: operationLease.holderToken,
      ...nextSettings,
    }).finally(() => {
      if (intentGeneration === recoveryKeyboardIntentGenerationRef.current) {
        appearance.setRecoveryKeyboardIntent(null);
      }
    });
    if (saved) setShortcutDraft((current) => current === draft ? null : current);
  }

  async function saveEscapeRecoverySetting(enabled: boolean) {
    setEscapeRecoveryDraft(enabled);
    const nextSettings = {
      ...recoverySettingsIntentRef.current,
      escapeRecoveryEnabled: enabled,
    };
    recoverySettingsIntentRef.current = nextSettings;
    const intentGeneration = ++recoveryKeyboardIntentGenerationRef.current;
    appearance.setRecoveryKeyboardIntent({
      shortcut: nextSettings.recoveryShortcut,
      escapeEnabled: nextSettings.escapeRecoveryEnabled,
    });
    const saved = await updateConfig({
      action: "set-recovery",
      operationId: crypto.randomUUID(),
      holderToken: operationLease.holderToken,
      ...nextSettings,
    }).finally(() => {
      if (intentGeneration === recoveryKeyboardIntentGenerationRef.current) {
        appearance.setRecoveryKeyboardIntent(null);
      }
    });
    setEscapeRecoveryDraft((current) => current === enabled ? null : current);
    if (!saved && recoverySettingsIntentRef.current === nextSettings) {
      recoverySettingsIntentRef.current = {
        recoveryShortcut: appearance.snapshot.config.recoveryShortcut,
        escapeRecoveryEnabled: appearance.snapshot.config.escapeRecoveryEnabled,
      };
    }
  }

  function recordShortcut(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!shortcutRecording) return;
    event.stopPropagation();
    if (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (["Control", "Alt", "Meta", "Shift"].includes(event.key)) return;
    const candidate = recoveryShortcutSchema.safeParse({
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      conflictTableVersion: SHORTCUT_CONFLICT_TABLE_VERSION,
    });
    setShortcutRecording(false);
    if (!candidate.success) {
      setStatus({ kind: "error", message: candidate.error.issues[0]?.message ?? "该快捷键不能用于安全恢复。" });
      return;
    }
    const draft = {
      code: candidate.data.code,
      ctrl: candidate.data.ctrl,
      alt: candidate.data.alt,
      meta: candidate.data.meta,
      shift: candidate.data.shift,
    };
    setShortcutDraft(draft);
    void saveRecoverySettings(draft);
  }

  if (selectedThemeId) {
    return (
      <main className="min-h-dvh bg-background px-4 py-6 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <ThemeEditor
            key={selectedThemeId}
            themeId={selectedThemeId}
            initialHandle={initialEditorHandle}
            initialHolderToken={initialEditorHolderToken}
            onClose={() => {
              setSelectedThemeId(null);
              setInitialEditorHandle(null);
              setInitialEditorHolderToken(undefined);
              void refreshThemes(search);
            }}
            onThemeSaved={(theme: StoredTheme) => {
              themeListRequestSequenceRef.current += 1;
              setThemes((current) => current.map((item) => item.id === theme.id ? {
                ...item,
                name: theme.name,
                declaredScheme: theme.declaredScheme,
                themeRevision: theme.themeRevision,
                updatedAt: theme.updatedAt,
                hasDraft: false,
              } : item));
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/reader" className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-foreground">
              <ChevronLeft aria-hidden className="size-4" />返回阅读器
            </Link>
            <div className="mt-5 flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent-strong"><Palette aria-hidden className="size-5" /></span>
              <div>
                <p className="text-xs font-bold text-accent uppercase">Appearance</p>
                <h1 className="font-serif text-4xl font-semibold">外观与主题</h1>
              </div>
            </div>
          </div>
          <a href="/appearance/recovery" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border-strong px-4 font-semibold hover:bg-surface-hover">
            <Shield aria-hidden className="size-4" />安全恢复
          </a>
        </header>

        <div className="min-h-7" role="status" aria-live="polite">
          {status.kind !== "idle" ? (
            <p className={status.kind === "error" || status.kind === "conflict" ? "text-danger" : "text-success"}>
              {status.kind === "saving" ? <LoaderCircle aria-hidden className="mr-2 inline size-4 animate-spin" /> : status.kind === "saved" ? <Check aria-hidden className="mr-2 inline size-4" /> : null}
              {status.message}
            </p>
          ) : null}
        </div>

        <section className="rounded-xl border border-border bg-surface p-5 sm:p-7">
          <h2 className="font-serif text-2xl font-semibold">模式与组合槽</h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="flex rounded-lg border border-border bg-surface-muted p-1" role="group" aria-label="主题模式">
              {(["light", "dark", "system"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={appearance.snapshot.config.mode === mode}
                  onClick={() => void setMode(mode)}
                  className={`min-h-10 flex-1 rounded-md px-3 text-sm font-semibold ${appearance.snapshot.config.mode === mode ? "bg-surface-selected shadow-[var(--shadow-control)]" : "text-muted hover:bg-surface-hover"}`}
                >
                  {mode === "light" ? "明亮" : mode === "dark" ? "暗色" : "跟随系统"}
                </button>
              ))}
            </div>
            {(["light", "dark"] as const).map((scheme) => {
              const selector = scheme === "light"
                ? appearance.snapshot.config.lightTheme
                : appearance.snapshot.config.darkTheme;
              const appliedTheme = scheme === "light"
                ? appearance.snapshot.lightTheme
                : appearance.snapshot.darkTheme;
              return (
                <SearchableThemePicker
                  key={scheme}
                  label={scheme === "light" ? "明亮槽" : "暗色槽"}
                  value={pickerSelection(selector, scheme, appliedTheme)}
                  allowedScheme={scheme}
                  builtinSchemes={[scheme]}
                  onChange={(selection) => void setSlot(scheme, selection)}
                />
              );
            })}
          </div>
          <p className="mt-4 text-sm text-muted">跟随系统时会按操作系统方案动态使用对应槽位；系统变化无需重新保存。</p>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl font-semibold">自定义主题</h2>
            </div>
            <button type="button" disabled={busy} onClick={() => setCreateOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-control-background px-4 font-semibold text-control-foreground hover:bg-control-hover-background disabled:opacity-50">
              <Plus aria-hidden className="size-4" />新建主题
            </button>
          </div>
          <form
            className="mt-5 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void refreshThemes();
            }}
          >
            <label className="sr-only" htmlFor="theme-search">搜索主题</label>
            <input id="theme-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索主题名称" className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3" />
            <button type="submit" className="rounded-lg border border-border px-4 font-semibold hover:bg-surface-hover">搜索</button>
          </form>
          <ul className="mt-5 divide-y divide-border">
            {themes.map((theme) => {
              const usage = themeUsageLabels(theme.id, appearance.snapshot, appearance.resolvedScheme);
              return (
              <li key={theme.id} className="flex flex-wrap items-center gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{theme.name}</p>
                  <p className="mt-1 text-xs text-subtle">
                    {theme.declaredScheme === "light" ? "明亮" : "暗色"} · 版本 {theme.themeRevision}
                    {theme.hasDraft ? " · 有草稿" : ""}
                    {usage.length > 0 ? ` · ${usage.join(" · ")}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => void applyTheme(theme.id)} className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-surface-hover">应用</button>
                  <button type="button" aria-label={`编辑${theme.name}`} title="编辑" onClick={() => setSelectedThemeId(theme.id)} className="rounded-lg p-2 text-muted hover:bg-surface-hover"><Edit3 aria-hidden className="size-4" /></button>
                  <button type="button" disabled={busy} aria-label={`复制${theme.name}`} title="复制" onClick={() => void duplicateTheme(theme)} className="rounded-lg p-2 text-muted hover:bg-surface-hover disabled:opacity-50"><Copy aria-hidden className="size-4" /></button>
                  <button type="button" aria-label={`重命名${theme.name}`} title="重命名" onClick={() => { if (openDraftResolution(theme)) return; setRenameTarget(theme); setRenameName(theme.name); setStatus({ kind: "idle", message: "" }); }} className="rounded-lg p-2 text-muted hover:bg-surface-hover"><TextCursorInput aria-hidden className="size-4" /></button>
                  <button type="button" aria-label={`切换${theme.name}类型`} title="切换明暗类型" onClick={() => void changeThemeScheme(theme)} className="rounded-lg p-2 text-muted hover:bg-surface-hover"><RefreshCw aria-hidden className="size-4" /></button>
                  <button type="button" disabled={busy} aria-label={`重置${theme.name}`} title="从其他主题重置" onClick={() => openResetTheme(theme)} className="rounded-lg p-2 text-muted hover:bg-surface-hover disabled:opacity-50"><RefreshCw aria-hidden className="size-4" /></button>
                  <button type="button" aria-label={`导出${theme.name}`} title="导出" onClick={() => void exportTheme(theme).catch(showError)} className="rounded-lg p-2 text-muted hover:bg-surface-hover"><Download aria-hidden className="size-4" /></button>
                  <button type="button" aria-label={`删除${theme.name}`} title="删除" onClick={() => void deleteTheme(theme)} className="rounded-lg p-2 text-danger hover:bg-surface-hover"><Trash2 aria-hidden className="size-4" /></button>
                </div>
              </li>
              );
            })}
          </ul>
          {themes.length === 0 ? <p className="py-8 text-center text-muted">还没有自定义主题。</p> : null}
          {nextCursor ? <button type="button" onClick={() => void loadMore()} className="mt-4 rounded-lg border border-border px-4 py-2 font-semibold hover:bg-surface-hover">加载更多</button> : null}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5 sm:p-7">
            <h2 className="font-serif text-2xl font-semibold">导入与备份</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button type="button" disabled={busy} onClick={() => themeImportRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 font-semibold hover:bg-surface-hover disabled:opacity-50"><Upload aria-hidden className="size-4" />导入单主题</button>
              <button type="button" onClick={() => void exportPackage().catch(showError)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 font-semibold hover:bg-surface-hover"><Download aria-hidden className="size-4" />导出整包</button>
              <button type="button" onClick={() => packageImportRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 font-semibold hover:bg-surface-hover sm:col-span-2"><FileJson aria-hidden className="size-4" />预览并恢复整包</button>
            </div>
            <input ref={themeImportRef} type="file" accept="application/json,.json" aria-label="选择单主题 JSON 文件" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importTheme(file); event.currentTarget.value = ""; }} />
            <input ref={packageImportRef} type="file" accept="application/json,.json" aria-label="选择整包备份 JSON 文件" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void preparePackage(file); event.currentTarget.value = ""; }} />
            <p className="mt-4 text-sm leading-6 text-muted">导出只包含可移植的正式主题与配置，不包含账户身份、草稿、锁或操作记录。</p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 sm:p-7">
            <h2 className="font-serif text-2xl font-semibold">安全恢复快捷键</h2>
            <p className="mt-2 text-sm leading-6 text-muted">固定 URL 始终可用。主组合键初始为空，必须包含 Ctrl、Alt 或 Meta。</p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={busy}
                aria-pressed={shortcutRecording}
                onClick={() => setShortcutRecording(true)}
                onKeyDown={recordShortcut}
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-border-strong bg-background px-3 text-left font-mono"
              >
                {shortcutRecording ? "请按下组合键…" : shortcutCode ? `${shortcutModifiers.ctrl ? "Ctrl+" : ""}${shortcutModifiers.alt ? "Alt+" : ""}${shortcutModifiers.meta ? "Meta+" : ""}${shortcutModifiers.shift ? "Shift+" : ""}${shortcutCode}` : "未设置主快捷键"}
              </button>
              {shortcutCode ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label="清除主快捷键"
                  title="清除主快捷键"
                  onClick={() => {
                    const draft = { code: "", ctrl: false, alt: false, meta: false, shift: false };
                    setShortcutDraft(draft);
                    setShortcutRecording(false);
                    void saveRecoverySettings(draft);
                  }}
                  className="grid size-11 shrink-0 place-items-center rounded-lg border border-border text-muted hover:bg-surface-hover"
                >
                  <X aria-hidden className="size-4" />
                </button>
              ) : null}
            </div>
            <label className="mt-4 flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                disabled={busy}
                checked={escapeRecoveryDraft ?? appearance.snapshot.config.escapeRecoveryEnabled}
                onChange={(event) => void saveEscapeRecoverySetting(event.target.checked)}
              />
              启用 2 秒内三次 Escape 后备手势
            </label>
            {shortcutDraft ? (
              <button type="button" disabled={busy} onClick={() => void saveRecoverySettings()} className="mt-5 rounded-lg bg-control-background px-4 py-2 font-semibold text-control-foreground hover:bg-control-hover-background disabled:opacity-50">
                {busy ? "正在自动保存快捷键" : "重试保存快捷键"}
              </button>
            ) : null}
          </div>
        </section>
      </div>

      {renameTarget ? (
        <RenameThemeDialog
          themeName={renameTarget.name}
          value={renameName}
          busy={status.kind === "saving"}
          message={status.message}
          messageIsError={status.kind === "error" || status.kind === "conflict"}
          onChange={setRenameName}
          onCancel={() => { if (status.kind !== "saving") setRenameTarget(null); }}
          onConfirm={() => void renameTheme()}
        />
      ) : null}

      {schemeChangePlan ? (
        <ThemeImpactDialog
          kind="change-scheme"
          themeName={schemeChangePlan.theme.name}
          targetScheme={schemeChangePlan.newScheme}
          affectedSlots={schemeChangePlan.impact.affectedSlots}
          currentlyActive={schemeChangePlan.impact.currentlyActive}
          hasDraft={schemeChangePlan.theme.hasDraft}
          busy={status.kind === "saving"}
          message={status.message}
          messageIsError={status.kind === "error" || status.kind === "conflict"}
          onCancel={() => { if (status.kind !== "saving") setSchemeChangePlan(null); }}
          onConfirm={() => void confirmThemeSchemeChange()}
        />
      ) : null}

      {deletePlan ? (
        <ThemeImpactDialog
          kind="delete"
          themeName={deletePlan.theme.name}
          affectedSlots={deletePlan.impact.affectedSlots}
          currentlyActive={deletePlan.impact.currentlyActive}
          hasDraft={deletePlan.theme.hasDraft}
          busy={status.kind === "saving"}
          message={status.message}
          messageIsError={status.kind === "error" || status.kind === "conflict"}
          onCancel={() => { if (status.kind !== "saving") setDeletePlan(null); }}
          onConfirm={() => void confirmDeleteTheme()}
        />
      ) : null}

      {createOpen ? (
        <ModalDialog
          labelledBy="create-theme-heading"
          onClose={() => { if (!busy) setCreateOpen(false); }}
          className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-strong)]"
        >
          <form onSubmit={(event) => { event.preventDefault(); void createTheme(event.currentTarget); }}>
            <h2 id="create-theme-heading" className="font-serif text-3xl font-semibold">新建自定义主题</h2>
            <label className="mt-5 block text-sm font-semibold">名称<input name="name" required data-dialog-initial-focus className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3" /></label>
            <label className="mt-4 block text-sm font-semibold">声明类型<select name="scheme" className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3"><option value="light">明亮</option><option value="dark">暗色</option></select></label>
            <div className="mt-4">
              <SearchableThemePicker
                label="复制来源"
                value={createSource}
                onChange={setCreateSource}
              />
            </div>
            <p className="mt-3 text-sm text-muted">来源类型不会改变新主题的声明类型；全部颜色表达式与回退色会被复制。</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setCreateOpen(false)} className="rounded-lg px-4 py-2 font-semibold hover:bg-surface-hover disabled:opacity-50">取消</button><button type="submit" disabled={busy} className="rounded-lg bg-control-background px-4 py-2 font-semibold text-control-foreground disabled:opacity-50">{busy ? "正在创建" : "创建并编辑"}</button></div>
          </form>
        </ModalDialog>
      ) : null}

      {resetTarget ? (
        <ResetThemeDialog
          target={resetTarget}
          source={resetSource}
          busy={busy}
          onSourceChange={setResetSource}
          onCancel={() => { if (!busy) setResetTarget(null); }}
          onConfirm={() => void resetTheme()}
        />
      ) : null}

      {restorePreview ? (
        <ModalDialog
          labelledBy="restore-heading"
          onClose={() => { if (!busy) setRestorePreview(null); }}
          className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-strong)]"
        >
            <h2 id="restore-heading" className="font-serif text-3xl font-semibold">确认整包恢复</h2>
            <dl className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-4 text-sm"><dt>现有主题</dt><dd>{restorePreview.summary.existingThemeCount}</dd><dt>导入主题</dt><dd>{restorePreview.summary.incomingThemeCount}</dd><dt>将清除草稿</dt><dd>{restorePreview.summary.removedDraftCount}</dd><dt>模式</dt><dd>{modeLabel(restorePreview.summary.modeBefore)} → {modeLabel(restorePreview.summary.modeAfter)}</dd></dl>
            <p className="mt-4 text-sm leading-6 text-muted">确认后将精确替换全部外观配置。若状态已变化或写入失败，现有配置保持不变。</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setRestorePreview(null)} className="rounded-lg px-4 py-2 font-semibold hover:bg-surface-hover disabled:opacity-50">取消</button><button type="button" disabled={busy} onClick={() => void confirmRestore()} className="rounded-lg bg-danger-background px-4 py-2 font-semibold text-danger-foreground disabled:opacity-50">{busy ? "正在恢复" : "确认恢复"}</button></div>
        </ModalDialog>
      ) : null}
    </main>
  );
}
