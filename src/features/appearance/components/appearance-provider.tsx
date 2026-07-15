"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { APPEARANCE_SCOPE_ID } from "@/features/appearance/appearance-css";
import {
  AUTHENTICATION_REQUIRED_EVENT,
  AUTH_SESSION_CLEARED_EVENT,
} from "@/lib/auth/auth-events";
import { validateThemeContrast } from "@/features/appearance/color-math";
import { appearanceKeys, fetchAppearanceSnapshot } from "@/features/appearance/hooks/appearance-queries";
import { RecoveryKeyboardController } from "@/features/appearance/recovery-keyboard";
import {
  applyThemeToScope,
  captureBrowserCanvas,
  clearThemeFromScope,
  shouldEnforceRuntimeContrast,
} from "@/features/appearance/runtime/theme-runtime";
import { navigateDocument, replaceDocument } from "@/lib/navigation/full-document";
import {
  APPEARANCE_CLIENT_TIMING,
  getThemeForScheme,
  resolveAppearanceScheme,
  SAFETY_PALETTE_V1,
  THEME_TOKEN_NAMES,
  type AppearanceSnapshot,
  type AppliedTheme,
  type DeclaredScheme,
} from "@/features/appearance/theme-contract";

export type AppearanceTrial = {
  theme: AppliedTheme;
  scheme: DeclaredScheme;
};

type RecoveryKeyboardIntent = {
  shortcut: AppearanceSnapshot["config"]["recoveryShortcut"];
  escapeEnabled: boolean;
};

type AppearanceContextValue = {
  snapshot: AppearanceSnapshot;
  resolvedScheme: DeclaredScheme;
  runtimeWarning: boolean;
  trial: AppearanceTrial | null;
  updateSnapshot: (snapshot: AppearanceSnapshot) => void;
  updateStateRevision: (stateRevision: string) => void;
  startTrial: (trial: AppearanceTrial) => void;
  stopTrial: () => void;
  setRecoveryKeyboardIntent: (intent: RecoveryKeyboardIntent | null) => void;
  navigateToRecovery: () => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function mergeAppearanceSnapshot(
  current: AppearanceSnapshot,
  candidate: AppearanceSnapshot,
): AppearanceSnapshot {
  const currentPublished = BigInt(current.publishedRevision);
  const candidatePublished = BigInt(candidate.publishedRevision);
  if (candidatePublished > currentPublished) return candidate;
  if (candidatePublished < currentPublished) return current;
  return BigInt(candidate.stateRevision) > BigInt(current.stateRevision)
    ? { ...current, stateRevision: candidate.stateRevision }
    : current;
}

const safetyNoticeStyle = {
  "--safe-background": SAFETY_PALETTE_V1.background,
  "--safe-foreground": SAFETY_PALETTE_V1.foreground,
  "--safe-border": SAFETY_PALETTE_V1.border,
  "--safe-accent": SAFETY_PALETTE_V1.accent,
  "--safe-accent-foreground": SAFETY_PALETTE_V1.accentForeground,
  "--safe-focus": SAFETY_PALETTE_V1.focus,
} as React.CSSProperties;

export function AppearanceProvider({
  initialSnapshot,
  children,
}: {
  initialSnapshot: AppearanceSnapshot;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [systemScheme, setSystemScheme] = useState<DeclaredScheme>("light");
  const [systemSchemeReady, setSystemSchemeReady] = useState(false);
  const [forcedColorsActive, setForcedColorsActive] = useState(false);
  const [trial, setTrial] = useState<AppearanceTrial | null>(null);
  const [runtimeWarning, setRuntimeWarning] = useState(false);
  const recoveryKeyboardSnapshotRef = useRef<RecoveryKeyboardIntent>({
    shortcut: initialSnapshot.config.recoveryShortcut,
    escapeEnabled: initialSnapshot.config.escapeRecoveryEnabled,
  });
  const recoveryKeyboardIntentRef = useRef<RecoveryKeyboardIntent | null>(null);

  const query = useQuery({
    queryKey: appearanceKeys.snapshot(),
    queryFn: async () => {
      const candidate = await fetchAppearanceSnapshot();
      const current = queryClient.getQueryData<AppearanceSnapshot>(appearanceKeys.snapshot());
      return current ? mergeAppearanceSnapshot(current, candidate) : candidate;
    },
    initialData: initialSnapshot,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const snapshot = query.data;

  useEffect(() => {
    recoveryKeyboardSnapshotRef.current = {
      shortcut: snapshot.config.recoveryShortcut,
      escapeEnabled: snapshot.config.escapeRecoveryEnabled,
    };
  }, [snapshot.config.escapeRecoveryEnabled, snapshot.config.recoveryShortcut]);

  const updateSnapshot = useCallback((candidate: AppearanceSnapshot) => {
    queryClient.setQueryData<AppearanceSnapshot>(appearanceKeys.snapshot(), (current) => {
      const next = current ? mergeAppearanceSnapshot(current, candidate) : candidate;
      recoveryKeyboardSnapshotRef.current = {
        shortcut: next.config.recoveryShortcut,
        escapeEnabled: next.config.escapeRecoveryEnabled,
      };
      return next;
    });
  }, [queryClient]);

  const updateStateRevision = useCallback((stateRevision: string) => {
    queryClient.setQueryData<AppearanceSnapshot>(appearanceKeys.snapshot(), (current) =>
      current && BigInt(stateRevision) > BigInt(current.stateRevision)
        ? { ...current, stateRevision }
        : current,
    );
  }, [queryClient]);

  const startTrial = useCallback((nextTrial: AppearanceTrial) => setTrial(nextTrial), []);
  const stopTrial = useCallback(() => setTrial(null), []);
  const setRecoveryKeyboardIntent = useCallback((intent: RecoveryKeyboardIntent | null) => {
    recoveryKeyboardIntentRef.current = intent;
  }, []);

  useLayoutEffect(() => {
    const schemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    const forcedColorsMedia = window.matchMedia("(forced-colors: active)");
    const updateScheme = () => {
      setSystemScheme(schemeMedia.matches ? "dark" : "light");
      setSystemSchemeReady(true);
    };
    const updateForcedColors = () => setForcedColorsActive(forcedColorsMedia.matches);
    updateScheme();
    updateForcedColors();
    schemeMedia.addEventListener("change", updateScheme);
    forcedColorsMedia.addEventListener("change", updateForcedColors);
    return () => {
      schemeMedia.removeEventListener("change", updateScheme);
      forcedColorsMedia.removeEventListener("change", updateForcedColors);
    };
  }, []);

  const resolvedScheme = resolveAppearanceScheme(snapshot.config.mode, systemScheme);
  const active = useMemo(
    () => trial ?? { theme: getThemeForScheme(snapshot, resolvedScheme), scheme: resolvedScheme },
    [resolvedScheme, snapshot, trial],
  );

  useLayoutEffect(() => {
    if (snapshot.config.mode === "system" && !systemSchemeReady && !trial) return;
    const scope = document.getElementById(APPEARANCE_SCOPE_ID);
    if (!scope) return;
    const result = applyThemeToScope(scope, active.theme.tokens, active.scheme);
    const runtimeTokens = Object.fromEntries(
      THEME_TOKEN_NAMES.map((name) => [
        name,
        {
          expression: active.theme.tokens[name].expression,
          fallback: result.computed[name] ?? active.theme.tokens[name].fallback,
        },
      ]),
    ) as typeof active.theme.tokens;
    const canvas = captureBrowserCanvas(scope, active.scheme) ?? active.theme.validationCanvas.color;
    const forcedColorsNow = forcedColorsActive || window.matchMedia("(forced-colors: active)").matches;
    const warning = shouldEnforceRuntimeContrast(forcedColorsNow) && validateThemeContrast(runtimeTokens, canvas).length > 0;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRuntimeWarning(warning);
    });
    return () => {
      cancelled = true;
    };
  }, [active, forcedColorsActive, snapshot.config.mode, systemSchemeReady, trial]);

  const cleanup = useCallback(() => {
    const scope = document.getElementById(APPEARANCE_SCOPE_ID);
    if (scope) clearThemeFromScope(scope);
    setTrial(null);
    queryClient.removeQueries({ queryKey: appearanceKeys.all });
  }, [queryClient]);

  const navigateToRecovery = useCallback(() => {
    cleanup();
    navigateDocument("/appearance/recovery");
  }, [cleanup]);

  useEffect(() => {
    const cleanupAndLogin = () => {
      cleanup();
      replaceDocument("/login");
    };
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, cleanup);
    window.addEventListener(AUTHENTICATION_REQUIRED_EVENT, cleanupAndLogin);
    return () => {
      window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, cleanup);
      window.removeEventListener(AUTHENTICATION_REQUIRED_EVENT, cleanupAndLogin);
      cleanup();
    };
  }, [cleanup]);

  useEffect(() => {
    const controller = new RecoveryKeyboardController();
    function onKeyDown(event: KeyboardEvent) {
      const keyboardConfig = recoveryKeyboardIntentRef.current ?? recoveryKeyboardSnapshotRef.current;
      const result = controller.handle(event, {
        shortcut: keyboardConfig.shortcut,
        escapeEnabled: keyboardConfig.escapeEnabled,
        now: performance.now(),
        escapeWindowMs: APPEARANCE_CLIENT_TIMING.escapeRecoveryWindowMs,
      });
      if (!result.navigate) return;
      if (result.preventDefault) event.preventDefault();
      navigateToRecovery();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateToRecovery]);

  const value = useMemo<AppearanceContextValue>(() => ({
    snapshot,
    resolvedScheme,
    runtimeWarning,
    trial,
    updateSnapshot,
    updateStateRevision,
    startTrial,
    stopTrial,
    setRecoveryKeyboardIntent,
    navigateToRecovery,
  }), [
    navigateToRecovery,
    resolvedScheme,
    runtimeWarning,
    snapshot,
    startTrial,
    stopTrial,
    setRecoveryKeyboardIntent,
    trial,
    updateSnapshot,
    updateStateRevision,
  ]);

  return (
    <AppearanceContext.Provider value={value}>
      {runtimeWarning ? (
        <div className="appearance-risk-notice" role="alert" style={safetyNoticeStyle}>
          当前设备解析出的主题颜色对比度可能不足。
          <button type="button" onClick={navigateToRecovery}>打开安全恢复</button>
        </div>
      ) : null}
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider.");
  return value;
}
