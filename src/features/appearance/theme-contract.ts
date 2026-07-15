export const TOKEN_CONTRACT_VERSION = 1 as const;
export const DRAFT_CONTRACT_VERSION = 1 as const;
export const BROWSER_VALIDATION_VERSION = 1 as const;
export const THEME_FILE_VERSION = 1 as const;
export const APPEARANCE_PACKAGE_VERSION = 1 as const;
export const SHORTCUT_CONFLICT_TABLE_VERSION = 1 as const;
export const CONTRAST_CONTRACT_VERSION = 1 as const;
export const APPEARANCE_CLIENT_TIMING = {
  leaseHeartbeatMs: 30_000,
  autosaveDebounceMs: 650,
  escapeRecoveryWindowMs: 2_000,
} as const;

export const BUILTIN_LIGHT_ID = "builtin-light" as const;
export const BUILTIN_DARK_ID = "builtin-dark" as const;

export const THEME_TOKEN_NAMES = [
  "background",
  "surface",
  "surfaceRaised",
  "surfaceMuted",
  "surfaceTranslucent",
  "surfaceHover",
  "surfaceSelected",
  "foreground",
  "muted",
  "subtle",
  "placeholder",
  "inverseForeground",
  "border",
  "borderStrong",
  "accent",
  "accentStrong",
  "accentSoft",
  "accentForeground",
  "controlBackground",
  "controlForeground",
  "controlHoverBackground",
  "nativeControlAccent",
  "success",
  "danger",
  "dangerBackground",
  "dangerForeground",
  "selectionBackground",
  "selectionForeground",
  "focusRing",
  "overlay",
  "overlayStrong",
  "shadowColor",
  "shadowStrongColor",
  "decorativeGrid",
  "articleLink",
  "articleLinkDecoration",
  "articleMarkBackground",
  "articleMarkForeground",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];
export type DeclaredScheme = "light" | "dark";
export type AppearanceMode = DeclaredScheme | "system";
export type ThemeTokenGroup = "基础" | "文字" | "边框与控件" | "状态" | "层叠与装饰" | "文章";

export type ThemeColorValue = {
  expression: string;
  fallback: string;
};

export type ThemeTokenMap = Record<ThemeTokenName, ThemeColorValue>;

export type ThemeValidationCanvas = {
  color: string;
  source: "browser-canvas";
};

export type BrowserValidationResultV1 = {
  expressionDigest: string;
  outcome: "computed";
  computed: string;
};

export type BrowserValidationReportV1 = {
  contractVersion: typeof BROWSER_VALIDATION_VERSION;
  expressionSetDigest: string;
  tokenContextDigest: string;
  declaredScheme: DeclaredScheme;
  results: Record<ThemeTokenName, BrowserValidationResultV1>;
};

export type FormalThemePayloadV1 = {
  tokenContractVersion: typeof TOKEN_CONTRACT_VERSION;
  tokens: ThemeTokenMap;
  validationCanvas: ThemeValidationCanvas;
  browserValidation: BrowserValidationReportV1 | null;
};

export type ThemeSelector = { kind: "builtin" } | { kind: "custom"; themeId: string };

export type RecoveryShortcut = {
  code: string;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  shift: boolean;
  conflictTableVersion: typeof SHORTCUT_CONFLICT_TABLE_VERSION;
};

export type AppearanceConfig = {
  mode: AppearanceMode;
  lightTheme: ThemeSelector;
  darkTheme: ThemeSelector;
  recoveryShortcut: RecoveryShortcut | null;
  escapeRecoveryEnabled: boolean;
};

export type PortableThemeV1 = FormalThemePayloadV1 & {
  name: string;
  declaredScheme: DeclaredScheme;
};

export type AppliedTheme = Omit<PortableThemeV1, "browserValidation"> & {
  id: string;
  selector: ThemeSelector;
};

export type AppearanceSnapshot = {
  stateRevision: string;
  publishedRevision: string;
  config: AppearanceConfig;
  lightTheme: AppliedTheme;
  darkTheme: AppliedTheme;
};

export type ThemeTokenRegistryEntry = {
  cssVariable: `--${string}`;
  fallbackCssVariable: `--theme-${string}-fallback`;
  activeCssVariable: `--theme-${string}-active`;
  label: string;
  group: ThemeTokenGroup;
  background: ThemeTokenName | "canvas";
  light: ThemeColorValue;
  dark: ThemeColorValue;
  metadata: boolean;
};

function color(expression: string, fallback = expression): ThemeColorValue {
  const normalized = fallback.length === 7 ? `${fallback}ff` : fallback;
  return { expression, fallback: normalized };
}

export const THEME_TOKEN_REGISTRY = {
  background: {
    cssVariable: "--background",
    fallbackCssVariable: "--theme-background-fallback",
    activeCssVariable: "--theme-background-active",
    label: "页面背景",
    group: "基础",
    background: "canvas",
    light: color("#f4f1e8"),
    dark: color("#171815"),
    metadata: true,
  },
  surface: {
    cssVariable: "--surface",
    fallbackCssVariable: "--theme-surface-fallback",
    activeCssVariable: "--theme-surface-active",
    label: "表面",
    group: "基础",
    background: "background",
    light: color("#fbfaf5"),
    dark: color("#1f211d"),
    metadata: false,
  },
  surfaceRaised: {
    cssVariable: "--surface-raised",
    fallbackCssVariable: "--theme-surface-raised-fallback",
    activeCssVariable: "--theme-surface-raised-active",
    label: "浮起表面",
    group: "基础",
    background: "surface",
    light: color("#ffffff"),
    dark: color("#272923"),
    metadata: false,
  },
  surfaceMuted: {
    cssVariable: "--surface-muted",
    fallbackCssVariable: "--theme-surface-muted-fallback",
    activeCssVariable: "--theme-surface-muted-active",
    label: "弱化表面",
    group: "基础",
    background: "surface",
    light: color("#ebe7dc"),
    dark: color("#30322c"),
    metadata: false,
  },
  surfaceTranslucent: {
    cssVariable: "--surface-translucent",
    fallbackCssVariable: "--theme-surface-translucent-fallback",
    activeCssVariable: "--theme-surface-translucent-active",
    label: "半透明表面",
    group: "基础",
    background: "background",
    light: color("#fbfaf5f2"),
    dark: color("#1f211df2"),
    metadata: false,
  },
  surfaceHover: {
    cssVariable: "--surface-hover",
    fallbackCssVariable: "--theme-surface-hover-fallback",
    activeCssVariable: "--theme-surface-hover-active",
    label: "悬停表面",
    group: "基础",
    background: "surface",
    light: color("#ebe7dc"),
    dark: color("#30322c"),
    metadata: false,
  },
  surfaceSelected: {
    cssVariable: "--surface-selected",
    fallbackCssVariable: "--theme-surface-selected-fallback",
    activeCssVariable: "--theme-surface-selected-active",
    label: "选中表面",
    group: "基础",
    background: "surface",
    light: color("#f0d9cd"),
    dark: color("#4d3027"),
    metadata: false,
  },
  foreground: {
    cssVariable: "--foreground",
    fallbackCssVariable: "--theme-foreground-fallback",
    activeCssVariable: "--theme-foreground-active",
    label: "正文文字",
    group: "文字",
    background: "background",
    light: color("#252821"),
    dark: color("#edede6"),
    metadata: false,
  },
  muted: {
    cssVariable: "--muted",
    fallbackCssVariable: "--theme-muted-fallback",
    activeCssVariable: "--theme-muted-active",
    label: "弱化文字",
    group: "文字",
    background: "background",
    light: color("#565950"),
    dark: color("#c0c1b7"),
    metadata: false,
  },
  subtle: {
    cssVariable: "--subtle",
    fallbackCssVariable: "--theme-subtle-fallback",
    activeCssVariable: "--theme-subtle-active",
    label: "次要文字",
    group: "文字",
    background: "background",
    light: color("#60635a"),
    dark: color("#a4a69c"),
    metadata: false,
  },
  placeholder: {
    cssVariable: "--placeholder",
    fallbackCssVariable: "--theme-placeholder-fallback",
    activeCssVariable: "--theme-placeholder-active",
    label: "占位文字",
    group: "文字",
    background: "surfaceRaised",
    light: color("#60635a"),
    dark: color("#a4a69c"),
    metadata: false,
  },
  inverseForeground: {
    cssVariable: "--inverse-foreground",
    fallbackCssVariable: "--theme-inverse-foreground-fallback",
    activeCssVariable: "--theme-inverse-foreground-active",
    label: "反色文字",
    group: "文字",
    background: "foreground",
    light: color("#ffffff"),
    dark: color("#171815"),
    metadata: false,
  },
  border: {
    cssVariable: "--border",
    fallbackCssVariable: "--theme-border-fallback",
    activeCssVariable: "--theme-border-active",
    label: "普通边框",
    group: "边框与控件",
    background: "surface",
    light: color("#797467"),
    dark: color("#85897a"),
    metadata: false,
  },
  borderStrong: {
    cssVariable: "--border-strong",
    fallbackCssVariable: "--theme-border-strong-fallback",
    activeCssVariable: "--theme-border-strong-active",
    label: "强调边框",
    group: "边框与控件",
    background: "surface",
    light: color("#6d685b"),
    dark: color("#9da191"),
    metadata: false,
  },
  accent: {
    cssVariable: "--accent",
    fallbackCssVariable: "--theme-accent-fallback",
    activeCssVariable: "--theme-accent-active",
    label: "强调色",
    group: "状态",
    background: "background",
    light: color("#a8472c"),
    dark: color("#e28965"),
    metadata: false,
  },
  accentStrong: {
    cssVariable: "--accent-strong",
    fallbackCssVariable: "--theme-accent-strong-fallback",
    activeCssVariable: "--theme-accent-strong-active",
    label: "强调色（强）",
    group: "状态",
    background: "background",
    light: color("#81341f"),
    dark: color("#f0a07e"),
    metadata: false,
  },
  accentSoft: {
    cssVariable: "--accent-soft",
    fallbackCssVariable: "--theme-accent-soft-fallback",
    activeCssVariable: "--theme-accent-soft-active",
    label: "强调色（柔和）",
    group: "状态",
    background: "surface",
    light: color("#f0d9cd"),
    dark: color("#4d3027"),
    metadata: false,
  },
  accentForeground: {
    cssVariable: "--accent-foreground",
    fallbackCssVariable: "--theme-accent-foreground-fallback",
    activeCssVariable: "--theme-accent-foreground-active",
    label: "强调色前景",
    group: "状态",
    background: "accent",
    light: color("#ffffff"),
    dark: color("#171815"),
    metadata: false,
  },
  controlBackground: {
    cssVariable: "--control-background",
    fallbackCssVariable: "--theme-control-background-fallback",
    activeCssVariable: "--theme-control-background-active",
    label: "按钮背景",
    group: "边框与控件",
    background: "surface",
    light: color("#252821"),
    dark: color("#edede6"),
    metadata: false,
  },
  controlForeground: {
    cssVariable: "--control-foreground",
    fallbackCssVariable: "--theme-control-foreground-fallback",
    activeCssVariable: "--theme-control-foreground-active",
    label: "按钮与图标前景",
    group: "边框与控件",
    background: "controlBackground",
    light: color("#ffffff"),
    dark: color("#171815"),
    metadata: false,
  },
  controlHoverBackground: {
    cssVariable: "--control-hover-background",
    fallbackCssVariable: "--theme-control-hover-background-fallback",
    activeCssVariable: "--theme-control-hover-background-active",
    label: "按钮悬停背景",
    group: "边框与控件",
    background: "surface",
    light: color("#81341f"),
    dark: color("#f0a07e"),
    metadata: false,
  },
  nativeControlAccent: {
    cssVariable: "--native-control-accent",
    fallbackCssVariable: "--theme-native-control-accent-fallback",
    activeCssVariable: "--theme-native-control-accent-active",
    label: "原生控件强调色",
    group: "边框与控件",
    background: "background",
    light: color("#a8472c"),
    dark: color("#e28965"),
    metadata: false,
  },
  success: {
    cssVariable: "--success",
    fallbackCssVariable: "--theme-success-fallback",
    activeCssVariable: "--theme-success-active",
    label: "成功状态",
    group: "状态",
    background: "background",
    light: color("#356342"),
    dark: color("#88bc94"),
    metadata: false,
  },
  danger: {
    cssVariable: "--danger",
    fallbackCssVariable: "--theme-danger-fallback",
    activeCssVariable: "--theme-danger-active",
    label: "危险文字与状态",
    group: "状态",
    background: "background",
    light: color("#96382e"),
    dark: color("#f08d80"),
    metadata: false,
  },
  dangerBackground: {
    cssVariable: "--danger-background",
    fallbackCssVariable: "--theme-danger-background-fallback",
    activeCssVariable: "--theme-danger-background-active",
    label: "危险操作背景",
    group: "状态",
    background: "surface",
    light: color("#96382e"),
    dark: color("#f08d80"),
    metadata: false,
  },
  dangerForeground: {
    cssVariable: "--danger-foreground",
    fallbackCssVariable: "--theme-danger-foreground-fallback",
    activeCssVariable: "--theme-danger-foreground-active",
    label: "危险操作前景",
    group: "状态",
    background: "dangerBackground",
    light: color("#ffffff"),
    dark: color("#171815"),
    metadata: false,
  },
  selectionBackground: {
    cssVariable: "--selection-background",
    fallbackCssVariable: "--theme-selection-background-fallback",
    activeCssVariable: "--theme-selection-background-active",
    label: "选择高亮背景",
    group: "状态",
    background: "surfaceRaised",
    light: color("#a8472c"),
    dark: color("#e28965"),
    metadata: false,
  },
  selectionForeground: {
    cssVariable: "--selection-foreground",
    fallbackCssVariable: "--theme-selection-foreground-fallback",
    activeCssVariable: "--theme-selection-foreground-active",
    label: "选择高亮文字",
    group: "状态",
    background: "selectionBackground",
    light: color("#ffffff"),
    dark: color("#171815"),
    metadata: false,
  },
  focusRing: {
    cssVariable: "--focus-ring",
    fallbackCssVariable: "--theme-focus-ring-fallback",
    activeCssVariable: "--theme-focus-ring-active",
    label: "焦点环",
    group: "边框与控件",
    background: "background",
    light: color("#7f2e17"),
    dark: color("#f0a07e"),
    metadata: false,
  },
  overlay: {
    cssVariable: "--overlay",
    fallbackCssVariable: "--theme-overlay-fallback",
    activeCssVariable: "--theme-overlay-active",
    label: "遮罩",
    group: "层叠与装饰",
    background: "background",
    light: color("#00000059"),
    dark: color("#00000080"),
    metadata: false,
  },
  overlayStrong: {
    cssVariable: "--overlay-strong",
    fallbackCssVariable: "--theme-overlay-strong-fallback",
    activeCssVariable: "--theme-overlay-strong-active",
    label: "遮罩（强）",
    group: "层叠与装饰",
    background: "background",
    light: color("#00000073"),
    dark: color("#000000a6"),
    metadata: false,
  },
  shadowColor: {
    cssVariable: "--shadow-color",
    fallbackCssVariable: "--theme-shadow-color-fallback",
    activeCssVariable: "--theme-shadow-color-active",
    label: "阴影颜色",
    group: "层叠与装饰",
    background: "background",
    light: color("#3632271a"),
    dark: color("#00000042"),
    metadata: false,
  },
  shadowStrongColor: {
    cssVariable: "--shadow-strong-color",
    fallbackCssVariable: "--theme-shadow-strong-color-fallback",
    activeCssVariable: "--theme-shadow-strong-color-active",
    label: "强阴影颜色",
    group: "层叠与装饰",
    background: "background",
    light: color("#00000042"),
    dark: color("#0000008f"),
    metadata: false,
  },
  decorativeGrid: {
    cssVariable: "--decorative-grid",
    fallbackCssVariable: "--theme-decorative-grid-fallback",
    activeCssVariable: "--theme-decorative-grid-active",
    label: "装饰网格",
    group: "层叠与装饰",
    background: "background",
    light: color("#d8d3c659"),
    dark: color("#575a5066"),
    metadata: false,
  },
  articleLink: {
    cssVariable: "--article-link",
    fallbackCssVariable: "--theme-article-link-fallback",
    activeCssVariable: "--theme-article-link-active",
    label: "文章链接",
    group: "文章",
    background: "surfaceRaised",
    light: color("#81341f"),
    dark: color("#f0a07e"),
    metadata: false,
  },
  articleLinkDecoration: {
    cssVariable: "--article-link-decoration",
    fallbackCssVariable: "--theme-article-link-decoration-fallback",
    activeCssVariable: "--theme-article-link-decoration-active",
    label: "文章链接下划线",
    group: "文章",
    background: "surfaceRaised",
    light: color("#a8472cb3"),
    dark: color("#e28965b3"),
    metadata: false,
  },
  articleMarkBackground: {
    cssVariable: "--article-mark-background",
    fallbackCssVariable: "--theme-article-mark-background-fallback",
    activeCssVariable: "--theme-article-mark-background-active",
    label: "文章标记背景",
    group: "文章",
    background: "surfaceRaised",
    light: color("#f0d9cd"),
    dark: color("#6a3c2f"),
    metadata: false,
  },
  articleMarkForeground: {
    cssVariable: "--article-mark-foreground",
    fallbackCssVariable: "--theme-article-mark-foreground-fallback",
    activeCssVariable: "--theme-article-mark-foreground-active",
    label: "文章标记文字",
    group: "文章",
    background: "articleMarkBackground",
    light: color("#252821"),
    dark: color("#ffffff"),
    metadata: false,
  },
} satisfies Record<ThemeTokenName, ThemeTokenRegistryEntry>;

function builtinTokens(scheme: DeclaredScheme): ThemeTokenMap {
  // Object.fromEntries cannot preserve a literal tuple's key union in TypeScript;
  // registry completeness is asserted above and tested at runtime.
  return Object.fromEntries(
    THEME_TOKEN_NAMES.map((name) => [name, { ...THEME_TOKEN_REGISTRY[name][scheme] }]),
  ) as ThemeTokenMap;
}

export const BUILTIN_THEMES: Record<DeclaredScheme, AppliedTheme> = {
  light: {
    id: BUILTIN_LIGHT_ID,
    selector: { kind: "builtin" },
    name: "内置明亮",
    declaredScheme: "light",
    tokenContractVersion: TOKEN_CONTRACT_VERSION,
    tokens: builtinTokens("light"),
    validationCanvas: { color: "#ffffff", source: "browser-canvas" },
  },
  dark: {
    id: BUILTIN_DARK_ID,
    selector: { kind: "builtin" },
    name: "内置暗色",
    declaredScheme: "dark",
    tokenContractVersion: TOKEN_CONTRACT_VERSION,
    tokens: builtinTokens("dark"),
    validationCanvas: { color: "#000000", source: "browser-canvas" },
  },
};

export const DEFAULT_APPEARANCE_SNAPSHOT: AppearanceSnapshot = {
  stateRevision: "0",
  publishedRevision: "0",
  config: {
    mode: "system",
    lightTheme: { kind: "builtin" },
    darkTheme: { kind: "builtin" },
    recoveryShortcut: null,
    escapeRecoveryEnabled: true,
  },
  lightTheme: BUILTIN_THEMES.light,
  darkTheme: BUILTIN_THEMES.dark,
};

export type ThemeTokenProbeRole = {
  currentColor: ThemeTokenName;
  background: ThemeTokenName | "canvas";
};

/** Representative role context used by browser CSSOM validation and runtime probes. */
export const THEME_TOKEN_PROBE_ROLES_V1 = {
  ...Object.fromEntries(
    THEME_TOKEN_NAMES.map((name) => [
      name,
      {
        currentColor: "foreground" as const,
        background: THEME_TOKEN_REGISTRY[name].background,
      },
    ]),
  ),
  accentSoft: { currentColor: "accentStrong", background: "surface" },
  controlBackground: { currentColor: "controlForeground", background: "surface" },
  controlHoverBackground: { currentColor: "controlForeground", background: "surface" },
  dangerBackground: { currentColor: "dangerForeground", background: "surface" },
  selectionBackground: { currentColor: "selectionForeground", background: "surfaceRaised" },
  articleLinkDecoration: { currentColor: "articleLink", background: "surfaceRaised" },
  articleMarkBackground: { currentColor: "articleMarkForeground", background: "surfaceRaised" },
} as Record<ThemeTokenName, ThemeTokenProbeRole>;

export const SEMANTIC_COLOR_USES_V1 = [
  "body-text",
  "surface-text",
  "muted-text",
  "subtle-text",
  "placeholder-text",
  "accent-text",
  "accent-soft-text",
  "accent-action",
  "success-text",
  "danger-text",
  "danger-action",
  "inverse-icon",
  "primary-control",
  "primary-control-hover",
  "selection",
  "article-link",
  "article-link-decoration",
  "article-mark",
  "control-border",
  "strong-control-border",
  "native-control-accent",
  "focus-indicator",
] as const;

export type SemanticColorUse = (typeof SEMANTIC_COLOR_USES_V1)[number];

export type ContrastPair = {
  id: string;
  foreground: ThemeTokenName;
  background: ThemeTokenName;
  minimum: 3 | 4.5;
  kind: "normal-text" | "large-text" | "non-text";
  label: string;
  uses: readonly SemanticColorUse[];
};

export const CONTRAST_PAIRS_V1 = [
  { id: "body-background", foreground: "foreground", background: "background", minimum: 4.5, kind: "normal-text", label: "正文 / 页面背景", uses: ["body-text"] },
  { id: "body-surface", foreground: "foreground", background: "surface", minimum: 4.5, kind: "normal-text", label: "正文 / 表面", uses: ["surface-text"] },
  { id: "body-raised", foreground: "foreground", background: "surfaceRaised", minimum: 4.5, kind: "normal-text", label: "正文 / 浮起表面", uses: ["surface-text"] },
  { id: "body-muted-surface", foreground: "foreground", background: "surfaceMuted", minimum: 4.5, kind: "normal-text", label: "正文 / 弱化表面", uses: ["surface-text"] },
  { id: "body-selected", foreground: "foreground", background: "surfaceSelected", minimum: 4.5, kind: "normal-text", label: "正文 / 选中表面", uses: ["surface-text"] },
  { id: "body-translucent", foreground: "foreground", background: "surfaceTranslucent", minimum: 4.5, kind: "normal-text", label: "正文 / 半透明表面", uses: ["surface-text"] },
  { id: "body-hover", foreground: "foreground", background: "surfaceHover", minimum: 4.5, kind: "normal-text", label: "正文 / 悬停表面", uses: ["surface-text"] },
  { id: "muted-background", foreground: "muted", background: "background", minimum: 4.5, kind: "normal-text", label: "弱化文字 / 页面背景", uses: ["muted-text"] },
  { id: "muted-surface", foreground: "muted", background: "surface", minimum: 4.5, kind: "normal-text", label: "弱化文字 / 表面", uses: ["muted-text"] },
  { id: "muted-raised", foreground: "muted", background: "surfaceRaised", minimum: 4.5, kind: "normal-text", label: "弱化文字 / 浮起表面", uses: ["muted-text"] },
  { id: "muted-muted-surface", foreground: "muted", background: "surfaceMuted", minimum: 4.5, kind: "normal-text", label: "弱化文字 / 弱化表面", uses: ["muted-text"] },
  { id: "muted-selected", foreground: "muted", background: "surfaceSelected", minimum: 4.5, kind: "normal-text", label: "弱化文字 / 选中表面", uses: ["muted-text"] },
  { id: "muted-translucent", foreground: "muted", background: "surfaceTranslucent", minimum: 4.5, kind: "normal-text", label: "弱化文字 / 半透明表面", uses: ["muted-text"] },
  { id: "muted-hover", foreground: "muted", background: "surfaceHover", minimum: 4.5, kind: "normal-text", label: "弱化文字 / 悬停表面", uses: ["muted-text"] },
  { id: "subtle-background", foreground: "subtle", background: "background", minimum: 4.5, kind: "normal-text", label: "次要文字 / 页面背景", uses: ["subtle-text"] },
  { id: "subtle-surface", foreground: "subtle", background: "surface", minimum: 4.5, kind: "normal-text", label: "次要文字 / 表面", uses: ["subtle-text"] },
  { id: "subtle-raised", foreground: "subtle", background: "surfaceRaised", minimum: 4.5, kind: "normal-text", label: "次要文字 / 浮起表面", uses: ["subtle-text"] },
  { id: "subtle-muted-surface", foreground: "subtle", background: "surfaceMuted", minimum: 4.5, kind: "normal-text", label: "次要文字 / 弱化表面", uses: ["subtle-text"] },
  { id: "subtle-selected", foreground: "subtle", background: "surfaceSelected", minimum: 4.5, kind: "normal-text", label: "次要文字 / 选中表面", uses: ["subtle-text"] },
  { id: "subtle-hover", foreground: "subtle", background: "surfaceHover", minimum: 4.5, kind: "normal-text", label: "次要文字 / 悬停表面", uses: ["subtle-text"] },
  { id: "placeholder-raised", foreground: "placeholder", background: "surfaceRaised", minimum: 4.5, kind: "normal-text", label: "占位文字 / 输入表面", uses: ["placeholder-text"] },
  { id: "placeholder-surface", foreground: "placeholder", background: "surface", minimum: 4.5, kind: "normal-text", label: "占位文字 / 表面", uses: ["placeholder-text"] },
  { id: "placeholder-background", foreground: "placeholder", background: "background", minimum: 4.5, kind: "normal-text", label: "占位文字 / 页面背景", uses: ["placeholder-text"] },
  { id: "accent-background", foreground: "accent", background: "background", minimum: 4.5, kind: "normal-text", label: "强调文字 / 页面背景", uses: ["accent-text"] },
  { id: "accent-surface", foreground: "accent", background: "surface", minimum: 4.5, kind: "normal-text", label: "强调文字 / 表面", uses: ["accent-text"] },
  { id: "accent-raised", foreground: "accent", background: "surfaceRaised", minimum: 4.5, kind: "normal-text", label: "强调文字 / 浮起表面", uses: ["accent-text"] },
  { id: "accent-muted-surface", foreground: "accent", background: "surfaceMuted", minimum: 4.5, kind: "normal-text", label: "强调文字 / 弱化表面", uses: ["accent-text"] },
  { id: "accent-translucent", foreground: "accent", background: "surfaceTranslucent", minimum: 4.5, kind: "normal-text", label: "强调文字 / 半透明表面", uses: ["accent-text"] },
  { id: "accent-hover", foreground: "accent", background: "surfaceHover", minimum: 4.5, kind: "normal-text", label: "强调文字 / 悬停表面", uses: ["accent-text"] },
  { id: "accent-strong-background", foreground: "accentStrong", background: "background", minimum: 4.5, kind: "normal-text", label: "强强调文字 / 页面背景", uses: ["accent-text"] },
  { id: "accent-strong-surface", foreground: "accentStrong", background: "surface", minimum: 4.5, kind: "normal-text", label: "强强调文字 / 表面", uses: ["accent-text"] },
  { id: "accent-strong-selected", foreground: "accentStrong", background: "surfaceSelected", minimum: 4.5, kind: "normal-text", label: "强强调文字 / 选中表面", uses: ["accent-text"] },
  { id: "accent-strong-hover", foreground: "accentStrong", background: "surfaceHover", minimum: 4.5, kind: "normal-text", label: "强强调文字 / 悬停表面", uses: ["accent-text"] },
  { id: "accent-soft-text", foreground: "accentStrong", background: "accentSoft", minimum: 4.5, kind: "normal-text", label: "强调文字 / 柔和强调背景", uses: ["accent-soft-text"] },
  { id: "accent-action", foreground: "accentForeground", background: "accent", minimum: 4.5, kind: "normal-text", label: "强调操作前景 / 强调背景", uses: ["accent-action"] },
  { id: "success-background", foreground: "success", background: "background", minimum: 4.5, kind: "normal-text", label: "成功文字 / 页面背景", uses: ["success-text"] },
  { id: "success-surface", foreground: "success", background: "surface", minimum: 4.5, kind: "normal-text", label: "成功文字 / 表面", uses: ["success-text"] },
  { id: "success-raised", foreground: "success", background: "surfaceRaised", minimum: 4.5, kind: "normal-text", label: "成功文字 / 浮起表面", uses: ["success-text"] },
  { id: "danger-background", foreground: "danger", background: "background", minimum: 4.5, kind: "normal-text", label: "危险文字 / 页面背景", uses: ["danger-text"] },
  { id: "danger-surface", foreground: "danger", background: "surface", minimum: 4.5, kind: "normal-text", label: "危险文字 / 表面", uses: ["danger-text"] },
  { id: "danger-raised", foreground: "danger", background: "surfaceRaised", minimum: 4.5, kind: "normal-text", label: "危险文字 / 浮起表面", uses: ["danger-text"] },
  { id: "danger-muted", foreground: "danger", background: "surfaceMuted", minimum: 4.5, kind: "normal-text", label: "危险文字 / 弱化表面", uses: ["danger-text"] },
  { id: "danger-hover", foreground: "danger", background: "surfaceHover", minimum: 4.5, kind: "normal-text", label: "危险文字 / 悬停表面", uses: ["danger-text"] },
  { id: "danger-action", foreground: "dangerForeground", background: "dangerBackground", minimum: 4.5, kind: "normal-text", label: "危险操作前景 / 危险背景", uses: ["danger-action"] },
  { id: "inverse-icon", foreground: "inverseForeground", background: "foreground", minimum: 4.5, kind: "normal-text", label: "反色图标 / 反色背景", uses: ["inverse-icon"] },
  { id: "control", foreground: "controlForeground", background: "controlBackground", minimum: 4.5, kind: "normal-text", label: "控件前景 / 控件背景", uses: ["primary-control"] },
  { id: "control-hover", foreground: "controlForeground", background: "controlHoverBackground", minimum: 4.5, kind: "normal-text", label: "控件前景 / 悬停背景", uses: ["primary-control-hover"] },
  { id: "selection", foreground: "selectionForeground", background: "selectionBackground", minimum: 4.5, kind: "normal-text", label: "选择文字 / 选择背景", uses: ["selection"] },
  { id: "article-link", foreground: "articleLink", background: "surfaceRaised", minimum: 4.5, kind: "normal-text", label: "文章链接 / 正文背景", uses: ["article-link"] },
  { id: "article-link-decoration", foreground: "articleLinkDecoration", background: "surfaceRaised", minimum: 3, kind: "non-text", label: "文章链接下划线 / 正文背景", uses: ["article-link-decoration"] },
  { id: "article-mark", foreground: "articleMarkForeground", background: "articleMarkBackground", minimum: 4.5, kind: "normal-text", label: "文章标记文字 / 标记背景", uses: ["article-mark"] },
  { id: "border-background", foreground: "border", background: "background", minimum: 3, kind: "non-text", label: "控件边框 / 页面背景", uses: ["control-border"] },
  { id: "border-surface", foreground: "border", background: "surface", minimum: 3, kind: "non-text", label: "控件边框 / 表面", uses: ["control-border"] },
  { id: "border-raised", foreground: "border", background: "surfaceRaised", minimum: 3, kind: "non-text", label: "控件边框 / 浮起表面", uses: ["control-border"] },
  { id: "border-muted", foreground: "border", background: "surfaceMuted", minimum: 3, kind: "non-text", label: "控件边框 / 弱化表面", uses: ["control-border"] },
  { id: "strong-border-background", foreground: "borderStrong", background: "background", minimum: 3, kind: "non-text", label: "强调边框 / 页面背景", uses: ["strong-control-border"] },
  { id: "strong-border-surface", foreground: "borderStrong", background: "surface", minimum: 3, kind: "non-text", label: "强调边框 / 表面", uses: ["strong-control-border"] },
  { id: "strong-border-raised", foreground: "borderStrong", background: "surfaceRaised", minimum: 3, kind: "non-text", label: "强调边框 / 浮起表面", uses: ["strong-control-border"] },
  { id: "strong-border-muted", foreground: "borderStrong", background: "surfaceMuted", minimum: 3, kind: "non-text", label: "强调边框 / 弱化表面", uses: ["strong-control-border"] },
  { id: "native-control", foreground: "nativeControlAccent", background: "background", minimum: 3, kind: "non-text", label: "原生控件强调 / 页面背景", uses: ["native-control-accent"] },
  { id: "native-control-surface", foreground: "nativeControlAccent", background: "surface", minimum: 3, kind: "non-text", label: "原生控件强调 / 表面", uses: ["native-control-accent"] },
  { id: "native-control-muted", foreground: "nativeControlAccent", background: "surfaceMuted", minimum: 3, kind: "non-text", label: "原生控件强调 / 弱化表面", uses: ["native-control-accent"] },
  { id: "focus-background", foreground: "focusRing", background: "background", minimum: 3, kind: "non-text", label: "焦点环 / 页面背景", uses: ["focus-indicator"] },
  { id: "focus-surface", foreground: "focusRing", background: "surface", minimum: 3, kind: "non-text", label: "焦点环 / 表面", uses: ["focus-indicator"] },
  { id: "focus-raised", foreground: "focusRing", background: "surfaceRaised", minimum: 3, kind: "non-text", label: "焦点环 / 浮起表面", uses: ["focus-indicator"] },
  { id: "focus-muted", foreground: "focusRing", background: "surfaceMuted", minimum: 3, kind: "non-text", label: "焦点环 / 弱化表面", uses: ["focus-indicator"] },
  { id: "focus-selected", foreground: "focusRing", background: "surfaceSelected", minimum: 3, kind: "non-text", label: "焦点环 / 选中表面", uses: ["focus-indicator"] },
  { id: "focus-translucent", foreground: "focusRing", background: "surfaceTranslucent", minimum: 3, kind: "non-text", label: "焦点环 / 半透明表面", uses: ["focus-indicator"] },
  { id: "focus-hover", foreground: "focusRing", background: "surfaceHover", minimum: 3, kind: "non-text", label: "焦点环 / 悬停表面", uses: ["focus-indicator"] },
] as const satisfies readonly ContrastPair[];

export const SAFETY_PALETTE_V1 = {
  version: 1,
  background: "#ffffff",
  surface: "#ffffff",
  foreground: "#111111",
  muted: "#303030",
  border: "#111111",
  accent: "#003f8f",
  accentForeground: "#ffffff",
  danger: "#8b0000",
  focus: "#ffbf00",
} as const;

/** Black/transparent are used only as alpha/luminance operands for mask-image. */
export const NON_DISPLAY_MASK_COLOR_ALLOWLIST_V1 = ["black", "transparent"] as const;

export function getThemeForScheme(snapshot: AppearanceSnapshot, scheme: DeclaredScheme): AppliedTheme {
  return scheme === "dark" ? snapshot.darkTheme : snapshot.lightTheme;
}

export function resolveAppearanceScheme(mode: AppearanceMode, systemScheme: DeclaredScheme): DeclaredScheme {
  return mode === "system" ? systemScheme : mode;
}

export function cloneThemeTokens(tokens: ThemeTokenMap): ThemeTokenMap {
  return Object.fromEntries(
    THEME_TOKEN_NAMES.map((name) => [name, { ...tokens[name] }]),
  ) as ThemeTokenMap;
}

export function canonicalExpressionSetInput(tokens: ThemeTokenMap): string {
  return JSON.stringify(THEME_TOKEN_NAMES.map((name) => [name, tokens[name].expression]));
}

export function canonicalTokenContextInput(
  tokens: ThemeTokenMap,
  validationCanvas: ThemeValidationCanvas,
  declaredScheme: DeclaredScheme,
): string {
  return JSON.stringify({
    tokenContractVersion: TOKEN_CONTRACT_VERSION,
    declaredScheme,
    validationCanvas,
    tokens: THEME_TOKEN_NAMES.map((name) => [name, tokens[name].expression, tokens[name].fallback]),
  });
}
