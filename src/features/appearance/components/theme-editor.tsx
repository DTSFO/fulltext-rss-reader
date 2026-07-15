"use client";

import { Check, FlaskConical, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { appearanceMutationRequest } from "@/features/appearance/appearance-client";
import { validateThemeContrast } from "@/features/appearance/color-math";
import { useAppearance } from "@/features/appearance/components/appearance-provider";
import {
  LatestAutosaveQueue,
  type AutosaveQueueItem,
} from "@/features/appearance/components/autosave-controller";
import { ThemePreview } from "@/features/appearance/components/theme-preview";
import {
  useAppearanceLease,
  type LeaseStatus,
} from "@/features/appearance/hooks/use-appearance-lease";
import {
  autosaveThemeDataSchema,
  resolveDraftDataSchema,
  themeDetailDataSchema,
  type LeaseHandle,
  type StoredTheme,
} from "@/features/appearance/schemas/appearance-schema";
import {
  buildBrowserValidationReport,
  captureBrowserCanvas,
  probeThemeExpressions,
} from "@/features/appearance/runtime/theme-runtime";
import {
  APPEARANCE_CLIENT_TIMING,
  BUILTIN_THEMES,
  DRAFT_CONTRACT_VERSION,
  THEME_TOKEN_NAMES,
  THEME_TOKEN_REGISTRY,
  type AppliedTheme,
  type DeclaredScheme,
  type ThemeTokenGroup,
  type ThemeTokenMap,
} from "@/features/appearance/theme-contract";
import { BrowserApiError, browserApiRequest } from "@/lib/api/browser-api";

export type EditorSaveState =
  | { kind: "idle" }
  | { kind: "editing" }
  | { kind: "validating" }
  | { kind: "saving" }
  | { kind: "formal-saved" }
  | { kind: "draft-saved"; diagnostics: string[] }
  | { kind: "validation-error"; diagnostics: string[] }
  | { kind: "lock-conflict"; message: string }
  | { kind: "network-error"; message: string }
  | { kind: "lease-lost"; message: string };

type SaveAction = EditorSaveState;

type EditorAutosaveSnapshot = {
  themeId: string;
  declaredScheme: DeclaredScheme;
  tokens: ThemeTokenMap;
  canvas: string;
  savedCanvas: string;
};

type AutosaveResult = ReturnType<typeof autosaveThemeDataSchema.parse>;

function saveReducer(_state: EditorSaveState, action: SaveAction): EditorSaveState {
  switch (action.kind) {
    case "idle":
    case "editing":
    case "validating":
    case "saving":
    case "formal-saved":
    case "draft-saved":
    case "validation-error":
    case "lock-conflict":
    case "network-error":
    case "lease-lost":
      return action;
  }
}

const GROUPS: ThemeTokenGroup[] = ["基础", "文字", "边框与控件", "状态", "层叠与装饰", "文章"];

function mergeDraftTokens(theme: StoredTheme, draft: Awaited<ReturnType<typeof loadTheme>>["draft"]): ThemeTokenMap {
  return Object.fromEntries(
    THEME_TOKEN_NAMES.map((name) => [
      name,
      draft?.payload.tokens[name]
        ? { ...theme.tokens[name], ...draft.payload.tokens[name] }
        : { ...theme.tokens[name] },
    ]),
  ) as ThemeTokenMap;
}

async function loadTheme(themeId: string) {
  return browserApiRequest(`/api/appearance/themes/${themeId}`, themeDetailDataSchema);
}

function safeTrialTokens(tokens: ThemeTokenMap, saved: ThemeTokenMap): ThemeTokenMap {
  return Object.fromEntries(
    THEME_TOKEN_NAMES.map((name) => [
      name,
      {
        expression: tokens[name].expression,
        fallback: /^#[0-9a-f]{8}$/.test(tokens[name].fallback) ? tokens[name].fallback : saved[name].fallback,
      },
    ]),
  ) as ThemeTokenMap;
}

function statusLabel(state: EditorSaveState): string {
  switch (state.kind) {
    case "idle": return "未编辑";
    case "editing": return "正在编辑";
    case "validating": return "正在校验";
    case "saving": return "正在保存";
    case "formal-saved": return "已保存正式主题";
    case "draft-saved": return "已保存为草稿";
    case "validation-error": return "校验失败";
    case "lock-conflict": return "其他会话正在编辑，当前只读";
    case "network-error": return "网络保存失败";
    case "lease-lost": return "编辑权已失效";
  }
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error instanceof BrowserApiError && error.requestId
    ? `${error.message}（请求编号：${error.requestId}）`
    : error.message;
}

function leaseConflictMessage(error: BrowserApiError | null, fallback: string): string {
  const message = apiErrorMessage(error, fallback);
  if (!error?.details || typeof error.details !== "object" || Array.isArray(error.details)) return message;
  const expiresAt = Reflect.get(error.details, "expiresAt");
  if (typeof expiresAt !== "string") return message;
  const expiry = new Date(expiresAt);
  return Number.isNaN(expiry.getTime())
    ? message
    : `${message} 当前租约最早于 ${expiry.toLocaleTimeString()} 到期，可随时重试。`;
}

function editAccessLabel(status: LeaseStatus): string {
  switch (status) {
    case "idle": return "未获取";
    case "acquiring": return "正在获取";
    case "active": return "可编辑";
    case "conflict": return "其他会话占用";
    case "lost": return "已失效";
    case "error": return "获取失败";
  }
}

export function ThemeEditor({
  themeId,
  initialHandle,
  initialHolderToken,
  onClose,
  onThemeSaved,
}: {
  themeId: string;
  initialHandle?: LeaseHandle | null;
  initialHolderToken?: string;
  onClose: () => void;
  onThemeSaved: (theme: StoredTheme) => void;
}) {
  const { startTrial, stopTrial, updateSnapshot, updateStateRevision } = useAppearance();
  const {
    holderToken,
    handles,
    status: leaseStatus,
    error: leaseError,
    acquire,
    adopt,
    release,
  } = useAppearanceLease(initialHolderToken);
  const [theme, setTheme] = useState<StoredTheme | null>(null);
  const [tokens, setTokens] = useState<ThemeTokenMap | null>(null);
  const [canvas, setCanvas] = useState(BUILTIN_THEMES.light.validationCanvas.color);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [draftPendingResolution, setDraftPendingResolution] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [trialEnabled, setTrialEnabled] = useState(false);
  const [closing, setClosing] = useState(false);
  const [state, dispatch] = useReducer(saveReducer, { kind: "idle" });
  const themeRevisionRef = useRef("0");
  const draftRevisionRef = useRef<string | null>(null);
  const handlesRef = useRef(handles);
  const initialHandleRef = useRef(initialHandle);
  const preparedAutosaveBodiesRef = useRef(new Map<string, string>());
  const mountedRef = useRef(true);
  const onThemeSavedRef = useRef(onThemeSaved);
  const updateSnapshotRef = useRef(updateSnapshot);
  const updateStateRevisionRef = useRef(updateStateRevision);
  const autosaveControllerRef = useRef<LatestAutosaveQueue<EditorAutosaveSnapshot, AutosaveResult> | null>(null);
  const stopUnsavedTrial = useCallback(() => {
    setTrialEnabled(false);
    stopTrial();
  }, [stopTrial]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    handlesRef.current = handles;
  }, [handles]);

  useEffect(() => {
    onThemeSavedRef.current = onThemeSaved;
  }, [onThemeSaved]);

  useEffect(() => {
    updateSnapshotRef.current = updateSnapshot;
  }, [updateSnapshot]);

  useEffect(() => {
    updateStateRevisionRef.current = updateStateRevision;
  }, [updateStateRevision]);

  useEffect(() => {
    const preparedBodies = preparedAutosaveBodiesRef.current;
    const controller = new LatestAutosaveQueue<EditorAutosaveSnapshot, AutosaveResult>({
      debounceMs: APPEARANCE_CLIENT_TIMING.autosaveDebounceMs,
      createOperationId: () => crypto.randomUUID(),
      unknownOutcomeRetries: 1,
      isUnknownOutcome: (error) =>
        !(error instanceof BrowserApiError) ||
        error.status === 0 || error.status >= 500 || (error.status >= 200 && error.status < 300),
      onStart: (item) => {
        if (controller.isLatestGeneration(item.generation)) dispatch({ kind: "validating" });
      },
      submit: async (item: AutosaveQueueItem<EditorAutosaveSnapshot>) => {
        let body = preparedBodies.get(item.operationId);
        if (!body) {
          const handle = handlesRef.current.find(
            (candidate) => candidate.resource.kind === "theme" && candidate.resource.themeId === item.snapshot.themeId,
          );
          const scope = document.getElementById("account-appearance-scope");
          if (!handle || !scope) throw new Error("主题编辑上下文已失效。");

          const capturedCanvas = captureBrowserCanvas(scope, item.snapshot.declaredScheme) ?? item.snapshot.canvas;
          const validationCanvas = {
            color: /^#[0-9a-f]{6}$/.test(capturedCanvas) ? capturedCanvas : item.snapshot.savedCanvas,
            source: "browser-canvas" as const,
          };
          const browserValidation = await buildBrowserValidationReport(
            scope,
            { tokens: item.snapshot.tokens, validationCanvas },
            item.snapshot.declaredScheme,
          );
          body = JSON.stringify({
            operationId: item.operationId,
            holderToken,
            handle,
            expectedThemeRevision: themeRevisionRef.current,
            expectedDraftRevision: draftRevisionRef.current,
            snapshot: {
              contractVersion: DRAFT_CONTRACT_VERSION,
              tokens: item.snapshot.tokens,
              validationCanvas,
              browserValidation,
            },
          });
          preparedBodies.set(item.operationId, body);
        }
        if (controller.isLatestGeneration(item.generation)) dispatch({ kind: "saving" });

        return browserApiRequest(
          `/api/appearance/themes/${item.snapshot.themeId}/autosave`,
          autosaveThemeDataSchema,
          { method: "PUT", body },
        );
      },
      onResult: async (item, result, isLatest) => {
        preparedBodies.delete(item.operationId);
        if (result.kind === "operation-completed") {
          if (result.outcome === "formal-saved") {
            if (!result.themeRevision) throw new Error("正式保存回执缺少主题 revision。");
            if (!result.snapshot) throw new Error("正式保存回执缺少外观快照。");
            const detail = await loadTheme(result.themeId);
            if (!mountedRef.current) return;
            themeRevisionRef.current = detail.theme.themeRevision;
            draftRevisionRef.current = detail.draft?.draftRevision ?? null;
            setDraftRevision(detail.draft?.draftRevision ?? null);
            setTheme(detail.theme);
            onThemeSavedRef.current(detail.theme);
            if (isLatest) {
              setCanvas(detail.theme.validationCanvas.color);
              dispatch({ kind: "formal-saved" });
            }
            updateSnapshotRef.current(result.snapshot);
            return;
          }
          if (!result.draftRevision) throw new Error("草稿保存回执缺少草稿 revision。");
          stopUnsavedTrial();
          draftRevisionRef.current = result.draftRevision;
          setDraftRevision(result.draftRevision);
          updateStateRevisionRef.current(result.stateRevision);
          if (isLatest) {
            dispatch({ kind: "draft-saved", diagnostics: result.diagnostics.map((item) => item.message) });
          }
          return;
        }

        if (result.kind === "formal-saved") {
          themeRevisionRef.current = result.theme.themeRevision;
          draftRevisionRef.current = null;
          setTheme(result.theme);
          setDraftRevision(null);
          onThemeSavedRef.current(result.theme);
          if (isLatest) {
            setCanvas(result.theme.validationCanvas.color);
            dispatch({ kind: "formal-saved" });
          }
          updateSnapshotRef.current(result.snapshot);
          return;
        }

        stopUnsavedTrial();
        draftRevisionRef.current = result.draftRevision;
        setDraftRevision(result.draftRevision);
        updateStateRevisionRef.current(result.stateRevision);
        if (isLatest) {
          dispatch({ kind: "draft-saved", diagnostics: result.diagnostics.map((item) => item.message) });
        }
      },
      onError: (item, caught, isLatest) => {
        const outcomeCouldBeUnknown =
          !(caught instanceof BrowserApiError) ||
          caught.status === 0 || caught.status >= 500 || (caught.status >= 200 && caught.status < 300);
        if (!outcomeCouldBeUnknown) preparedBodies.delete(item.operationId);
        stopUnsavedTrial();
        if (!isLatest) return;
        if (caught instanceof BrowserApiError && ["APPEARANCE_LEASE_EXPIRED", "APPEARANCE_LEASE_LOST"].includes(caught.code)) {
          dispatch({ kind: "lease-lost", message: apiErrorMessage(caught, "编辑权已失效。") });
        } else if (caught instanceof BrowserApiError && caught.code === "APPEARANCE_LEASE_CONFLICT") {
          dispatch({ kind: "lock-conflict", message: apiErrorMessage(caught, "其他会话正在编辑。") });
        } else if (
          caught instanceof BrowserApiError &&
          [
            "APPEARANCE_VALIDATION_FAILED",
            "APPEARANCE_BROWSER_VALIDATION_REQUIRED",
            "PAYLOAD_TOO_LARGE",
            "VALIDATION_ERROR",
          ].includes(caught.code)
        ) {
          dispatch({ kind: "validation-error", diagnostics: [apiErrorMessage(caught, "主题校验失败。")] });
        } else {
          dispatch({ kind: "network-error", message: apiErrorMessage(caught, "自动保存失败。") });
        }
      },
    });
    autosaveControllerRef.current = controller;
    return () => {
      controller.dispose();
      preparedBodies.clear();
      if (autosaveControllerRef.current === controller) autosaveControllerRef.current = null;
    };
  }, [holderToken, stopUnsavedTrial, themeId]);

  useEffect(() => {
    let cancelled = false;
    dispatch({ kind: "idle" });
    void (async () => {
      const suppliedHandle = initialHandleRef.current;
      initialHandleRef.current = null;
      const acquiredHandles = suppliedHandle ? [suppliedHandle] : await acquire([{ kind: "theme", themeId }]);
      if (suppliedHandle) adopt(acquiredHandles);
      const handle = acquiredHandles[0];
      const detail = await loadTheme(themeId);
      if (cancelled) return;
      setTheme(detail.theme);
      themeRevisionRef.current = detail.theme.themeRevision;
      if (!handle) {
        setCanvas(detail.theme.validationCanvas.color);
        setDraftRevision(null);
        draftRevisionRef.current = null;
        setTokens(detail.theme.tokens);
        return;
      }
      setCanvas(detail.draft?.payload.validationCanvas.color ?? detail.theme.validationCanvas.color);
      setDraftRevision(detail.draft?.draftRevision ?? null);
      draftRevisionRef.current = detail.draft?.draftRevision ?? null;
      const pending = handle.requiresDraftResolution;
      setDraftPendingResolution(pending);
      setTokens(pending ? detail.theme.tokens : mergeDraftTokens(detail.theme, detail.draft));
    })().catch((caught: unknown) => {
      if (!cancelled) dispatch({ kind: "network-error", message: caught instanceof Error ? caught.message : "主题加载失败。" });
    });
    return () => {
      cancelled = true;
      stopTrial();
    };
  }, [accessAttempt, acquire, adopt, stopTrial, themeId]);

  useEffect(() => {
    if (leaseStatus !== "lost" && leaseStatus !== "conflict" && leaseStatus !== "error") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      dispatch(
        leaseStatus === "lost"
          ? { kind: "lease-lost", message: apiErrorMessage(leaseError, "编辑权已失效。") }
          : leaseStatus === "conflict"
            ? { kind: "lock-conflict", message: leaseConflictMessage(leaseError, "该主题正在其他会话中编辑。") }
            : { kind: "network-error", message: apiErrorMessage(leaseError, "无法取得主题编辑权。") },
      );
      stopUnsavedTrial();
    });
    return () => {
      cancelled = true;
    };
  }, [leaseError, leaseStatus, stopUnsavedTrial]);

  useEffect(() => {
    if (!trialEnabled || !theme || !tokens) return;
    const trialTheme: AppliedTheme = {
      id: theme.id,
      selector: { kind: "custom", themeId: theme.id },
      name: theme.name,
      declaredScheme: theme.declaredScheme,
      tokenContractVersion: theme.tokenContractVersion,
      tokens: safeTrialTokens(tokens, theme.tokens),
      validationCanvas: { color: /^#[0-9a-f]{6}$/.test(canvas) ? canvas : theme.validationCanvas.color, source: "browser-canvas" },
    };
    startTrial({ theme: trialTheme, scheme: theme.declaredScheme });
  }, [canvas, startTrial, theme, tokens, trialEnabled]);

  async function resolveDraft(resolution: "resume" | "discard") {
    const handle = handles[0];
    if (!theme || !handle) return;
    const data = await appearanceMutationRequest(
      `/api/appearance/themes/${theme.id}/draft/resolve`,
      resolveDraftDataSchema,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          holderToken,
          handle,
          resolution,
        }),
      },
    );
    setDraftPendingResolution(false);
    updateStateRevision(data.stateRevision);
    setDraftRevision(data.draft?.draftRevision ?? null);
    draftRevisionRef.current = data.draft?.draftRevision ?? null;
    setTokens(resolution === "resume" && data.draft ? mergeDraftTokens(theme, data.draft) : theme.tokens);
    setCanvas(resolution === "resume" && data.draft ? data.draft.payload.validationCanvas.color : theme.validationCanvas.color);
  }

  function enqueueAutosave(nextTokens: ThemeTokenMap, nextCanvas: string) {
    if (!theme || draftPendingResolution || leaseStatus !== "active") return;
    dispatch({ kind: "editing" });
    autosaveControllerRef.current?.edit({
      themeId: theme.id,
      declaredScheme: theme.declaredScheme,
      tokens: Object.fromEntries(
        THEME_TOKEN_NAMES.map((name) => [name, { ...nextTokens[name] }]),
      ) as ThemeTokenMap,
      canvas: nextCanvas,
      savedCanvas: theme.validationCanvas.color,
    });
  }

  function updateToken(name: (typeof THEME_TOKEN_NAMES)[number], field: "expression" | "fallback", value: string) {
    if (!theme || !tokens || draftPendingResolution || leaseStatus !== "active" || closing) return;
    let nextTokens = { ...tokens, [name]: { ...tokens[name], [field]: value } };
    if (field === "expression" && !window.matchMedia("(forced-colors: active)").matches) {
      const scope = document.getElementById("account-appearance-scope");
      const computed = scope
        ? probeThemeExpressions(scope, nextTokens, theme.declaredScheme).computed[name]
        : undefined;
      if (computed) {
        nextTokens = { ...nextTokens, [name]: { ...nextTokens[name], fallback: computed } };
      }
    }
    setTokens(nextTokens);
    enqueueAutosave(nextTokens, canvas);
  }

  async function closeEditor() {
    if (closing) return;
    setClosing(true);
    const saved = await (autosaveControllerRef.current?.flushAndWait() ?? Promise.resolve(true));
    if (!saved) {
      setClosing(false);
      return;
    }
    stopTrial();
    await release();
    onClose();
  }

  const localDiagnostics = useMemo(() => {
    if (!tokens) return [];
    const invalidFallbacks = THEME_TOKEN_NAMES.flatMap((name) =>
      /^#[0-9a-f]{8}$/.test(tokens[name].fallback) ? [] : [`${THEME_TOKEN_REGISTRY[name].label} 的回退色必须是小写 #rrggbbaa。`],
    );
    return [
      ...invalidFallbacks,
      ...(/^#[0-9a-f]{6}$/.test(canvas) ? [] : ["浏览器画布色必须是小写 #rrggbb。"]),
      ...(invalidFallbacks.length === 0 && /^#[0-9a-f]{6}$/.test(canvas)
        ? validateThemeContrast(tokens, canvas).map((item) => item.message)
        : []),
    ];
  }, [canvas, tokens]);

  if (!theme || !tokens) {
    return <div className="rounded-xl border border-border bg-surface p-8 text-muted"><LoaderCircle aria-hidden className="mr-2 inline size-4 animate-spin" />正在加载主题编辑器</div>;
  }

  const readOnly = leaseStatus !== "active" || draftPendingResolution || closing;

  return (
    <section className="space-y-6" aria-labelledby="theme-editor-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="theme-editor-heading" className="min-w-0 font-serif text-3xl font-semibold [overflow-wrap:anywhere]">{theme.name}</h1>
          <p className="mt-1 text-sm text-muted">{theme.declaredScheme === "light" ? "明亮主题" : "暗色主题"} · 版本 {theme.themeRevision}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setTrialEnabled((value) => !value);
              if (trialEnabled) stopTrial();
            }}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-surface-hover"
          >
            <FlaskConical aria-hidden className="size-4" />
            {trialEnabled ? "退出全页试用" : "开启全页试用"}
          </button>
          <button
            type="button"
            disabled={closing}
            aria-busy={closing}
            onClick={() => void closeEditor()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-muted hover:bg-surface-hover disabled:opacity-60"
          >
            {closing ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <X aria-hidden className="size-4" />}
            {closing ? "正在关闭" : "关闭编辑"}
          </button>
        </div>
      </div>

      {draftPendingResolution ? (
        <div className="rounded-xl border-2 border-border-strong bg-surface-muted p-5">
          <p className="font-semibold">该主题保留有上一编辑会话的草稿。</p>
          <p className="mt-2 text-sm leading-6 text-muted">选择继续草稿，或丢弃并恢复最后正式版本后，才能保存新的编辑。</p>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={() => void resolveDraft("resume")} className="rounded-lg bg-control-background px-4 py-2 font-semibold text-control-foreground">继续草稿</button>
            <button type="button" onClick={() => void resolveDraft("discard")} className="rounded-lg border border-border-strong px-4 py-2 font-semibold">丢弃草稿</button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm" role="status" aria-live="polite">
        {state.kind === "saving" || state.kind === "validating" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : state.kind === "formal-saved" ? <Check aria-hidden className="size-4 text-success" /> : state.kind === "draft-saved" ? <Save aria-hidden className="size-4 text-accent" /> : <RotateCcw aria-hidden className="size-4 text-muted" />}
        <span className="font-semibold">{statusLabel(state)}</span>
        <span className="text-muted">编辑权：{editAccessLabel(leaseStatus)} {draftRevision ? `· 草稿版本 ${draftRevision}` : ""}</span>
        {"message" in state ? <span className="text-danger">{state.message}</span> : null}
        {state.kind === "network-error" ? (
          <button
            type="button"
            className="rounded-lg border border-border-strong px-3 py-1 font-semibold hover:bg-surface-hover"
            onClick={() => autosaveControllerRef.current?.retryLatest()}
          >
            重试保存
          </button>
        ) : null}
        {state.kind === "lock-conflict" || state.kind === "lease-lost" ? (
          <button
            type="button"
            className="rounded-lg border border-border-strong px-3 py-1 font-semibold hover:bg-surface-hover"
            onClick={() => setAccessAttempt((attempt) => attempt + 1)}
          >
            重试获取编辑权
          </button>
        ) : null}
      </div>

      <ThemePreview tokens={tokens} savedTokens={theme.tokens} scheme={theme.declaredScheme} />

      {(localDiagnostics.length > 0 || state.kind === "draft-saved" || state.kind === "validation-error") ? (
        <div className="rounded-xl border border-danger bg-surface p-4" role="alert">
          <p className="font-semibold text-danger">当前配色不能成为正式主题</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {localDiagnostics.map((message) => <li key={message}>{message}</li>)}
            {(state.kind === "draft-saved" || state.kind === "validation-error")
              ? state.diagnostics.map((message) => <li key={message}>{message}</li>)
              : null}
          </ul>
        </div>
      ) : null}

      <label className="block max-w-xs text-sm font-semibold">
        校验画布色（自动采集）
        <span className="mt-2 flex items-center gap-2">
          <span
            aria-hidden
            className="size-8 shrink-0 rounded border border-border-strong"
            style={{ backgroundColor: /^#[0-9a-f]{6}$/.test(canvas) ? canvas : theme.validationCanvas.color }}
          />
          <input
            value={canvas}
            readOnly
            className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 font-mono text-sm"
          />
        </span>
      </label>

      {GROUPS.map((group) => (
        <fieldset key={group} disabled={readOnly} className="rounded-xl border border-border bg-surface p-4 sm:p-6">
          <legend className="px-2 font-serif text-xl font-semibold">{group}</legend>
          <div className="mt-2 space-y-5">
            {THEME_TOKEN_NAMES.filter((name) => THEME_TOKEN_REGISTRY[name].group === group).map((name) => (
              <div key={name} className="grid gap-3 border-b border-border pb-5 last:border-0 last:pb-0 lg:grid-cols-[12rem_1fr_14rem] lg:items-end">
                <p className="font-semibold">{THEME_TOKEN_REGISTRY[name].label}</p>
                <label className="block text-sm font-medium">
                  CSS 颜色表达式
                  <input
                    aria-label={`${THEME_TOKEN_REGISTRY[name].label}表达式`}
                    value={tokens[name].expression}
                    onChange={(event) => updateToken(name, "expression", event.target.value)}
                    className="mt-2 h-11 w-full rounded-lg border border-border bg-surface-raised px-3 font-mono text-sm"
                  />
                </label>
                <label className="block text-sm font-medium">
                  绝对回退色
                  <span className="mt-2 flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-8 shrink-0 rounded border border-border-strong"
                      style={{
                        backgroundColor: /^#[0-9a-f]{8}$/.test(tokens[name].fallback)
                          ? tokens[name].fallback
                          : theme.tokens[name].fallback,
                      }}
                    />
                    <input
                      aria-label={`${THEME_TOKEN_REGISTRY[name].label}回退色`}
                      value={tokens[name].fallback}
                      onChange={(event) => updateToken(name, "fallback", event.target.value)}
                      className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 font-mono text-sm"
                    />
                  </span>
                </label>
              </div>
            ))}
          </div>
        </fieldset>
      ))}
    </section>
  );
}
