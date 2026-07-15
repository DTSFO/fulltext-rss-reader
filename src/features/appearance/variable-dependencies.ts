import {
  THEME_TOKEN_NAMES,
  THEME_TOKEN_REGISTRY,
  type ThemeTokenMap,
  type ThemeTokenName,
} from "@/features/appearance/theme-contract";

export type CssVariableReference = {
  property: string;
  hasFallback: boolean;
};

function isIdentifierCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_-]/u.test(value));
}

function findClosingParenthesis(expression: string, openingIndex: number): number {
  let depth = 1;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (let index = openingIndex + 1; index < expression.length; index += 1) {
    const character = expression[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findTopLevelComma(value: string): number {
  let depth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) return index;
  }
  return -1;
}

/**
 * Extracts var() references without evaluating CSS. The parser keeps fallback
 * information so runtime probes do not reject `var(--missing, red)` merely
 * because the primary external property is absent.
 */
export function extractCssVariableReferences(expression: string): CssVariableReference[] {
  const references: CssVariableReference[] = [];

  for (let index = 0; index < expression.length; index += 1) {
    if (expression.slice(index, index + 4).toLowerCase() !== "var(") continue;
    if (isIdentifierCharacter(expression[index - 1])) continue;

    const closingIndex = findClosingParenthesis(expression, index + 3);
    if (closingIndex < 0) continue;
    const body = expression.slice(index + 4, closingIndex);
    const commaIndex = findTopLevelComma(body);
    const property = (commaIndex < 0 ? body : body.slice(0, commaIndex)).trim();
    if (/^--[A-Za-z0-9_-]+$/u.test(property)) {
      references.push({
        property,
        hasFallback: commaIndex >= 0 && body.slice(commaIndex + 1).trim().length > 0,
      });
    }

    // A fallback may itself contain var(), so continue scanning inside the
    // current function instead of jumping directly past its closing token.
  }

  return references;
}

export function extractVariableDependencies(expression: string): string[] {
  return [...new Set(extractCssVariableReferences(expression).map((reference) => reference.property))];
}

/**
 * Resolves only the dependency control flow of var(), not its color value.
 * Fallback references are required only when the primary property is absent.
 */
export function hasUnresolvedCssVariableReference(
  expression: string,
  isAvailable: (property: string) => boolean,
): boolean {
  for (let index = 0; index < expression.length; index += 1) {
    if (expression.slice(index, index + 4).toLowerCase() !== "var(") continue;
    if (isIdentifierCharacter(expression[index - 1])) continue;

    const closingIndex = findClosingParenthesis(expression, index + 3);
    if (closingIndex < 0) return true;
    const body = expression.slice(index + 4, closingIndex);
    const commaIndex = findTopLevelComma(body);
    const property = (commaIndex < 0 ? body : body.slice(0, commaIndex)).trim();
    if (!/^--[A-Za-z0-9_-]+$/u.test(property)) return true;

    if (!isAvailable(property)) {
      if (commaIndex < 0) return true;
      const fallback = body.slice(commaIndex + 1).trim();
      if (!fallback || hasUnresolvedCssVariableReference(fallback, isAvailable)) return true;
    }
    index = closingIndex;
  }
  return false;
}

const DEPENDENCY_TOKEN_BY_VARIABLE = new Map<string, ThemeTokenName>(
  THEME_TOKEN_NAMES.flatMap((name) => [
    [THEME_TOKEN_REGISTRY[name].cssVariable, name] as const,
    [THEME_TOKEN_REGISTRY[name].activeCssVariable, name] as const,
  ]),
);

const KNOWN_THEME_VARIABLES = new Set<string>(
  THEME_TOKEN_NAMES.flatMap((name) => [
    THEME_TOKEN_REGISTRY[name].cssVariable,
    THEME_TOKEN_REGISTRY[name].activeCssVariable,
    THEME_TOKEN_REGISTRY[name].fallbackCssVariable,
  ]),
);

const ALWAYS_DEFINED_THEME_VARIABLES = new Set<string>(
  THEME_TOKEN_NAMES.flatMap((name) => [
    THEME_TOKEN_REGISTRY[name].cssVariable,
    THEME_TOKEN_REGISTRY[name].fallbackCssVariable,
  ]),
);

function requiredThemeDependencies(expression: string): ThemeTokenName[] {
  const dependencies = new Set<ThemeTokenName>();

  function collect(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      if (value.slice(index, index + 4).toLowerCase() !== "var(") continue;
      if (isIdentifierCharacter(value[index - 1])) continue;

      const closingIndex = findClosingParenthesis(value, index + 3);
      if (closingIndex < 0) continue;
      const body = value.slice(index + 4, closingIndex);
      const commaIndex = findTopLevelComma(body);
      const property = (commaIndex < 0 ? body : body.slice(0, commaIndex)).trim();
      const dependency = themeVariableForToken(property);
      if (dependency) dependencies.add(dependency);

      if (commaIndex >= 0 && !ALWAYS_DEFINED_THEME_VARIABLES.has(property)) {
        collect(body.slice(commaIndex + 1));
      }
      index = closingIndex;
    }
  }

  collect(expression);
  return [...dependencies];
}

export function themeVariableForToken(variable: string): ThemeTokenName | null {
  return DEPENDENCY_TOKEN_BY_VARIABLE.get(variable) ?? null;
}

export function isKnownThemeVariable(variable: string): boolean {
  return KNOWN_THEME_VARIABLES.has(variable);
}

export function buildThemeDependencyGraph(
  tokens: ThemeTokenMap,
): ReadonlyMap<ThemeTokenName, readonly ThemeTokenName[]> {
  return new Map(
    THEME_TOKEN_NAMES.map((name) => [
      name,
      requiredThemeDependencies(tokens[name].expression),
    ]),
  );
}

export function findCyclicThemeTokens(tokens: ThemeTokenMap): Set<ThemeTokenName> {
  const graph = buildThemeDependencyGraph(tokens);
  const visiting = new Set<ThemeTokenName>();
  const visited = new Set<ThemeTokenName>();
  const cyclic = new Set<ThemeTokenName>();
  const stack: ThemeTokenName[] = [];

  function visit(token: ThemeTokenName): void {
    if (visiting.has(token)) {
      const start = stack.lastIndexOf(token);
      for (const member of stack.slice(Math.max(0, start))) cyclic.add(member);
      cyclic.add(token);
      return;
    }
    if (visited.has(token)) return;

    visiting.add(token);
    stack.push(token);
    for (const dependency of graph.get(token) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(token);
    visited.add(token);
  }

  for (const token of THEME_TOKEN_NAMES) visit(token);
  return cyclic;
}
