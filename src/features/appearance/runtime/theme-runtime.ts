import {
  BROWSER_VALIDATION_VERSION,
  canonicalExpressionSetInput,
  canonicalTokenContextInput,
  THEME_TOKEN_NAMES,
  THEME_TOKEN_PROBE_ROLES_V1,
  THEME_TOKEN_REGISTRY,
  type BrowserValidationReportV1,
  type DeclaredScheme,
  type FormalThemePayloadV1,
  type ThemeTokenMap,
  type ThemeTokenName,
} from "@/features/appearance/theme-contract";
import { sha256Hex } from "@/features/appearance/digest";
import {
  buildThemeDependencyGraph,
  findCyclicThemeTokens,
  hasUnresolvedCssVariableReference,
  isKnownThemeVariable,
} from "@/features/appearance/variable-dependencies";

export { extractVariableDependencies } from "@/features/appearance/variable-dependencies";
export const findCyclicTokens = findCyclicThemeTokens;

const PROBE_PROPERTIES = [
  { name: "--appearance-color-probe-a", initialValue: "rgb(1, 2, 3)" },
  { name: "--appearance-color-probe-b", initialValue: "rgb(4, 5, 6)" },
] as const;

let registeredProbeProperties: boolean | null = null;

function canvasContext(): CanvasRenderingContext2D | null {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.getContext("2d", { willReadFrequently: true });
}

export function rgbaToCanonical(r: number, g: number, b: number, a: number): string {
  const byte = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}${byte(a)}`;
}

export function computedColorToCanonical(value: string): string | null {
  const context = canvasContext();
  if (!context) return null;
  try {
    context.clearRect(0, 0, 1, 1);
    context.globalCompositeOperation = "copy";
    context.fillStyle = "rgba(1, 2, 3, 0.004)";
    const sentinel = context.fillStyle;
    context.fillStyle = value;
    if (context.fillStyle === sentinel && value.trim().toLowerCase() !== "rgba(1, 2, 3, 0.004)") return null;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return rgbaToCanonical(r, g, b, a);
  } catch {
    return null;
  }
}

function registeredColorPropertyWorks(property: (typeof PROBE_PROPERTIES)[number]): boolean {
  const probe = document.createElement("span");
  probe.style.setProperty(property.name, "rotate(1deg)");
  document.documentElement.append(probe);
  try {
    const expected = computedColorToCanonical(property.initialValue);
    const actual = computedColorToCanonical(getComputedStyle(probe).getPropertyValue(property.name).trim());
    return expected !== null && actual === expected;
  } finally {
    probe.remove();
  }
}

function supportsRegisteredColorProbe(): boolean {
  if (registeredProbeProperties !== null) return registeredProbeProperties;
  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") {
    registeredProbeProperties = false;
    return false;
  }

  for (const property of PROBE_PROPERTIES) {
    try {
      CSS.registerProperty({
        name: property.name,
        syntax: "<color>",
        inherits: false,
        initialValue: property.initialValue,
      });
    } catch {
      // Registration is process-global. Verify the fixed property instead of
      // assuming every exception means a harmless duplicate registration.
    }
    if (!registeredColorPropertyWorks(property)) {
      registeredProbeProperties = false;
      return false;
    }
  }
  registeredProbeProperties = true;
  return true;
}

export function hasUnresolvedRequiredExternalVariable(
  expression: string,
  readProperty: (property: string) => string,
): boolean {
  return hasUnresolvedCssVariableReference(
    expression,
    (property) => isKnownThemeVariable(property) || Boolean(readProperty(property).trim()),
  );
}

function createProbeRoot(scope: HTMLElement, tokens: ThemeTokenMap, scheme: DeclaredScheme): HTMLDivElement {
  const root = document.createElement("div");
  root.setAttribute("aria-hidden", "true");
  root.style.position = "fixed";
  root.style.inset = "-9999px auto auto -9999px";
  root.style.pointerEvents = "none";
  root.style.opacity = "0";
  root.style.colorScheme = scheme;

  for (const name of THEME_TOKEN_NAMES) {
    const registry = THEME_TOKEN_REGISTRY[name];
    root.style.setProperty(registry.fallbackCssVariable, tokens[name].fallback);
    root.style.setProperty(
      registry.cssVariable,
      `var(${registry.activeCssVariable}, var(${registry.fallbackCssVariable}))`,
    );
  }
  scope.append(root);
  return root;
}

function createRoleProbe(
  root: HTMLElement,
  tokens: ThemeTokenMap,
  name: ThemeTokenName,
): { context: HTMLSpanElement; probe: HTMLSpanElement } {
  const role = THEME_TOKEN_PROBE_ROLES_V1[name];
  const context = document.createElement("span");
  const probe = document.createElement("span");
  const currentColorRegistry = THEME_TOKEN_REGISTRY[role.currentColor];

  // The parent supplies the role fallback when its dynamic currentColor token
  // is invalid; the child otherwise resolves that token in the complete theme
  // context. This mirrors inherited color without treating an inherited
  // sentinel as a successful expression result.
  context.style.color = tokens[role.currentColor].fallback;
  context.style.backgroundColor = role.background === "canvas"
    ? "Canvas"
    : `var(${THEME_TOKEN_REGISTRY[role.background].cssVariable})`;
  probe.style.color = `var(${currentColorRegistry.cssVariable})`;
  context.append(probe);
  root.append(context);
  return { context, probe };
}

function resolveRegisteredColor(probe: HTMLElement, expression: string): string | null {
  const results = PROBE_PROPERTIES.map((property) => {
    const child = document.createElement("span");
    child.style.setProperty(property.name, expression);
    probe.append(child);
    try {
      return computedColorToCanonical(getComputedStyle(child).getPropertyValue(property.name).trim());
    } finally {
      child.remove();
    }
  });
  return results[0] && results[0] === results[1] ? results[0] : null;
}

function resolveColorProperty(probe: HTMLElement, expression: string): string | null {
  const child = document.createElement("span");
  child.style.color = "rgb(1, 2, 3)";
  const sentinel = child.style.color;
  child.style.color = expression;
  if (child.style.color === sentinel && expression.trim().toLowerCase() !== sentinel) return null;
  probe.append(child);
  try {
    const computed = computedColorToCanonical(getComputedStyle(child).color);
    if (!computed) return null;
    const inherited = computedColorToCanonical(getComputedStyle(probe).color);
    const contextual = /(^|[^a-z0-9_-])currentcolor([^a-z0-9_-]|$)/iu.test(expression);
    return !contextual && inherited === computed && expression.includes("var(") ? null : computed;
  } finally {
    child.remove();
  }
}

function resolveProbeColor(probe: HTMLElement, expression: string): string | null {
  return supportsRegisteredColorProbe()
    ? resolveRegisteredColor(probe, expression)
    : resolveColorProperty(probe, expression);
}

export type ProbeResult = {
  computed: Partial<Record<ThemeTokenName, string>>;
  unresolved: ThemeTokenName[];
};

export function shouldEnforceRuntimeContrast(forcedColorsActive: boolean): boolean {
  return !forcedColorsActive;
}

export function probeThemeExpressions(
  scope: HTMLElement,
  tokens: ThemeTokenMap,
  scheme: DeclaredScheme,
): ProbeResult {
  const root = createProbeRoot(scope, tokens, scheme);
  const graph = buildThemeDependencyGraph(tokens);
  const cyclic = findCyclicThemeTokens(tokens);
  const computed: Partial<Record<ThemeTokenName, string>> = {};
  const unresolved = new Set<ThemeTokenName>();
  const resolved = new Set<ThemeTokenName>();
  const resolving = new Set<ThemeTokenName>();

  function resolveToken(name: ThemeTokenName): void {
    if (resolved.has(name) || unresolved.has(name) || resolving.has(name)) return;
    if (cyclic.has(name) || typeof CSS === "undefined") {
      unresolved.add(name);
      return;
    }
    resolving.add(name);
    for (const dependency of graph.get(name) ?? []) resolveToken(dependency);

    const expression = tokens[name].expression;
    if (!CSS.supports("color", expression)) {
      unresolved.add(name);
      resolving.delete(name);
      return;
    }
    const { context, probe } = createRoleProbe(root, tokens, name);
    const canonical = resolveProbeColor(probe, expression);
    context.remove();
    if (!canonical) {
      unresolved.add(name);
    } else {
      computed[name] = canonical;
      root.style.setProperty(THEME_TOKEN_REGISTRY[name].activeCssVariable, expression);
      resolved.add(name);
    }
    resolving.delete(name);
  }

  try {
    for (const name of THEME_TOKEN_NAMES) resolveToken(name);
  } finally {
    root.remove();
  }
  return { computed, unresolved: THEME_TOKEN_NAMES.filter((name) => unresolved.has(name)) };
}

export function captureBrowserCanvas(scope: HTMLElement, scheme: DeclaredScheme): string | null {
  const probe = document.createElement("span");
  probe.style.position = "fixed";
  probe.style.inset = "-9999px auto auto -9999px";
  probe.style.colorScheme = scheme;
  probe.style.color = "Canvas";
  scope.append(probe);
  try {
    const canonical = computedColorToCanonical(getComputedStyle(probe).color);
    return canonical ? canonical.slice(0, 7) : null;
  } finally {
    probe.remove();
  }
}

export async function buildBrowserValidationReport(
  scope: HTMLElement,
  payload: Pick<FormalThemePayloadV1, "tokens" | "validationCanvas">,
  declaredScheme: DeclaredScheme,
): Promise<BrowserValidationReportV1 | null> {
  const result = probeThemeExpressions(scope, payload.tokens, declaredScheme);
  if (result.unresolved.length > 0) return null;
  const [expressionSetDigest, tokenContextDigest, ...expressionDigests] = await Promise.all([
    sha256Hex(canonicalExpressionSetInput(payload.tokens)),
    sha256Hex(canonicalTokenContextInput(payload.tokens, payload.validationCanvas, declaredScheme)),
    ...THEME_TOKEN_NAMES.map((name) => sha256Hex(payload.tokens[name].expression)),
  ]);
  return {
    contractVersion: BROWSER_VALIDATION_VERSION,
    expressionSetDigest,
    tokenContextDigest,
    declaredScheme,
    results: Object.fromEntries(
      THEME_TOKEN_NAMES.map((name, index) => [
        name,
        {
          expressionDigest: expressionDigests[index] ?? "",
          outcome: "computed",
          computed: result.computed[name] ?? payload.tokens[name].fallback,
        },
      ]),
    ) as BrowserValidationReportV1["results"],
  };
}

export function applyThemeToScope(
  scope: HTMLElement,
  tokens: ThemeTokenMap,
  scheme: DeclaredScheme,
): ProbeResult {
  const result = probeThemeExpressions(scope, tokens, scheme);
  for (const name of THEME_TOKEN_NAMES) {
    const registry = THEME_TOKEN_REGISTRY[name];
    scope.style.setProperty(registry.fallbackCssVariable, tokens[name].fallback);
    // Nested preview/trial scopes must own the fixed alias. An inherited custom
    // property is substituted in its defining ancestor and cannot see a child
    // scope's active override.
    scope.style.setProperty(
      registry.cssVariable,
      `var(${registry.activeCssVariable}, var(${registry.fallbackCssVariable}))`,
    );
    if (result.computed[name]) scope.style.setProperty(registry.activeCssVariable, tokens[name].expression);
    else scope.style.removeProperty(registry.activeCssVariable);
  }
  scope.style.colorScheme = scheme;
  return result;
}

export function clearThemeFromScope(scope: HTMLElement): void {
  for (const name of THEME_TOKEN_NAMES) {
    scope.style.removeProperty(THEME_TOKEN_REGISTRY[name].cssVariable);
    scope.style.removeProperty(THEME_TOKEN_REGISTRY[name].activeCssVariable);
    scope.style.removeProperty(THEME_TOKEN_REGISTRY[name].fallbackCssVariable);
  }
  scope.style.removeProperty("color-scheme");
}
