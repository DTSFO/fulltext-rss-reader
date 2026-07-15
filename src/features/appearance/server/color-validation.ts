import "server-only";

import { createHash } from "node:crypto";
import { utils } from "@asamuzakjp/css-color";
import { TokenType, tokenize, type CSSToken } from "@csstools/css-tokenizer";

import { validateThemeContrast } from "@/features/appearance/color-math";
import {
  canonicalExpressionSetInput,
  canonicalTokenContextInput,
  THEME_TOKEN_NAMES,
  THEME_TOKEN_REGISTRY,
  type BrowserValidationReportV1,
  type DeclaredScheme,
  type FormalThemePayloadV1,
  type ThemeTokenMap,
  type ThemeTokenName,
} from "@/features/appearance/theme-contract";
import {
  formalThemePayloadV1Schema,
  looseThemeSnapshotV1Schema,
  type LooseThemeSnapshotV1,
} from "@/features/appearance/schemas/appearance-schema";
import { APPEARANCE_TECHNICAL_LIMITS } from "@/features/appearance/server/technical-limits";
import { findCyclicThemeTokens } from "@/features/appearance/variable-dependencies";

export type AppearanceDiagnostic = {
  path: string;
  code:
    | "EXPRESSION_EMPTY"
    | "EXPRESSION_TOO_LARGE"
    | "EXPRESSION_UNSAFE"
    | "EXPRESSION_NOT_COLOR"
    | "EXPRESSION_CYCLE"
    | "FALLBACK_INVALID"
    | "CANVAS_INVALID"
    | "BROWSER_VALIDATION_REQUIRED"
    | "BROWSER_VALIDATION_MISMATCH"
    | "CONTRAST_TOO_LOW"
    | "PAYLOAD_INVALID";
  message: string;
  ratio?: number;
  minimum?: number;
};

export type ExpressionValidation =
  | { valid: true; kind: "deterministic" | "browser-only"; expression: string }
  | { valid: false; diagnostic: AppearanceDiagnostic };

const forbiddenTokenTypes = new Set<TokenType>([
  TokenType.AtKeyword,
  TokenType.BadString,
  TokenType.BadURL,
  TokenType.CDC,
  TokenType.CDO,
  TokenType.Comment,
  TokenType.OpenCurly,
  TokenType.CloseCurly,
  TokenType.Semicolon,
  TokenType.String,
  TokenType.URL,
]);

// Browser validation is intentionally forward-compatible with new color roots.
// Reject standardized roots that are already known to produce a different CSS
// value type; any other structurally safe unknown root still requires an exact
// browser report before it can become formal.
const knownNonColorRootFunctions = new Set([
  "abs", "acos", "asin", "atan", "atan2", "calc", "clamp", "cos", "exp", "hypot", "log", "max", "min", "mod", "pow", "rem", "round", "sign", "sin", "sqrt", "tan",
  "matrix", "matrix3d", "perspective", "rotate", "rotate3d", "rotatex", "rotatey", "rotatez", "scale", "scale3d", "scalex", "scaley", "scalez", "skew", "skewx", "skewy", "translate", "translate3d", "translatex", "translatey", "translatez",
  "blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia",
  "conic-gradient", "cross-fade", "element", "image", "image-set", "linear-gradient", "paint", "radial-gradient", "repeating-conic-gradient", "repeating-linear-gradient", "repeating-radial-gradient",
  "circle", "ellipse", "inset", "path", "polygon", "ray", "xywh",
  "counter", "counters", "cubic-bezier", "filter", "fit-content", "minmax", "repeat", "steps", "symbols",
]);

const knownNonColorIdentifiers = new Set([
  "auto",
  "inherit",
  "initial",
  "none",
  "normal",
  "revert",
  "revert-layer",
  "unset",
]);

// CSS Color system colors are contextual and intentionally use the browser
// report path. Unknown identifiers such as `foo` are never accepted merely
// because a caller supplied a forged report.
const systemColorIdentifiers = new Set([
  "accentcolor",
  "accentcolortext",
  "activetext",
  "buttonborder",
  "buttonface",
  "buttontext",
  "canvas",
  "canvastext",
  "field",
  "fieldtext",
  "graytext",
  "highlight",
  "highlighttext",
  "linktext",
  "mark",
  "marktext",
  "selecteditem",
  "selecteditemtext",
  "visitedtext",
  // Deprecated system colors remain implemented by some supported browsers.
  "activeborder",
  "activecaption",
  "appworkspace",
  "background",
  "buttonhighlight",
  "buttonshadow",
  "captiontext",
  "inactiveborder",
  "inactivecaption",
  "inactivecaptiontext",
  "infobackground",
  "infotext",
  "menu",
  "menutext",
  "scrollbar",
  "threeddarkshadow",
  "threedface",
  "threedhighlight",
  "threedlightshadow",
  "threedshadow",
  "window",
  "windowframe",
  "windowtext",
]);

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenValue(token: CSSToken): string | undefined {
  const details = token[4];
  return details && typeof details === "object" && "value" in details && typeof details.value === "string"
    ? details.value
    : undefined;
}

function expressionDiagnostic(path: string, code: AppearanceDiagnostic["code"], message: string): ExpressionValidation {
  return { valid: false, diagnostic: { path, code, message } };
}

export function validateCssColorExpression(
  rawExpression: string,
  options: {
    path?: string;
    declaredScheme?: DeclaredScheme;
    tokens?: ThemeTokenMap;
  } = {},
): ExpressionValidation {
  const path = options.path ?? "expression";
  const expression = rawExpression.trim();

  if (!expression) {
    return expressionDiagnostic(path, "EXPRESSION_EMPTY", "颜色表达式不能为空。");
  }

  if (Buffer.byteLength(expression, "utf8") > APPEARANCE_TECHNICAL_LIMITS.expressionBytes) {
    return expressionDiagnostic(path, "EXPRESSION_TOO_LARGE", "颜色表达式超过技术长度限制。");
  }

  if (/[\u0000-\u001f\u007f]/u.test(expression)) {
    return expressionDiagnostic(path, "EXPRESSION_UNSAFE", "颜色表达式不能包含控制字符。");
  }

  const parseErrors: unknown[] = [];
  const tokens = tokenize({ css: expression }, { onParseError: (error) => parseErrors.push(error) });
  if (parseErrors.length > 0) {
    return expressionDiagnostic(path, "EXPRESSION_UNSAFE", "颜色表达式包含无法解析的 CSS 结构。");
  }

  const significant = tokens.filter((token) => token[0] !== TokenType.Whitespace && token[0] !== TokenType.EOF);
  if (significant.length === 0) {
    return expressionDiagnostic(path, "EXPRESSION_EMPTY", "颜色表达式不能为空。");
  }

  const first = significant[0];
  if (first[0] !== TokenType.Hash && first[0] !== TokenType.Ident && first[0] !== TokenType.Function) {
    return expressionDiagnostic(path, "EXPRESSION_NOT_COLOR", "表达式不是单个 CSS 颜色值。");
  }

  let depth = 0;
  let topLevelClosedAt = first[0] === TokenType.Function ? -1 : 0;

  for (let index = 0; index < significant.length; index += 1) {
    const token = significant[index];
    const type = token[0];

    if (forbiddenTokenTypes.has(type)) {
      return expressionDiagnostic(path, "EXPRESSION_UNSAFE", "颜色表达式包含被禁止的声明、URL 或块结构。");
    }

    if (type === TokenType.Colon) {
      return expressionDiagnostic(path, "EXPRESSION_UNSAFE", "颜色表达式不能包含声明分隔符。");
    }

    if (type === TokenType.Delim) {
      const value = tokenValue(token);
      if (value === "!" || value === "<" || value === ">" || value === "@" || value === "\\") {
        return expressionDiagnostic(path, "EXPRESSION_UNSAFE", "颜色表达式包含危险分隔符。");
      }
    }

    if (type === TokenType.Function) {
      const name = tokenValue(token)?.toLowerCase();
      if (name === "url") {
        return expressionDiagnostic(path, "EXPRESSION_UNSAFE", "颜色表达式不能读取 URL。");
      }
      depth += 1;
    } else if (type === TokenType.OpenParen) {
      depth += 1;
    } else if (type === TokenType.CloseParen) {
      depth -= 1;
      if (depth < 0) {
        return expressionDiagnostic(path, "EXPRESSION_UNSAFE", "颜色表达式括号不匹配。");
      }
      if (depth === 0 && first[0] === TokenType.Function && topLevelClosedAt < 0) {
        topLevelClosedAt = index;
      }
    } else if (type === TokenType.OpenSquare || type === TokenType.CloseSquare) {
      return expressionDiagnostic(path, "EXPRESSION_UNSAFE", "颜色表达式不能包含方括号块。");
    }

    if (depth > APPEARANCE_TECHNICAL_LIMITS.expressionNesting) {
      return expressionDiagnostic(path, "EXPRESSION_TOO_LARGE", "颜色表达式嵌套超过技术限制。");
    }
  }

  if (depth !== 0) {
    return expressionDiagnostic(path, "EXPRESSION_UNSAFE", "颜色表达式括号未闭合。");
  }

  if (first[0] !== TokenType.Function && significant.length !== 1) {
    return expressionDiagnostic(path, "EXPRESSION_NOT_COLOR", "只能提交一个 CSS 颜色值。");
  }

  if (first[0] === TokenType.Function && topLevelClosedAt !== significant.length - 1) {
    return expressionDiagnostic(path, "EXPRESSION_NOT_COLOR", "只能提交一个顶层 CSS 颜色值。");
  }

  const customProperty = options.tokens
    ? Object.fromEntries(
        THEME_TOKEN_NAMES.map((name) => [THEME_TOKEN_REGISTRY[name].cssVariable, options.tokens?.[name].expression ?? ""]),
      )
    : undefined;

  const rootName = tokenValue(first)?.toLowerCase();
  const requiresBrowserContext = significant.some((token) => {
    const value = tokenValue(token)?.toLowerCase();
    return (
      (token[0] === TokenType.Function && value === "var") ||
      (token[0] === TokenType.Ident && Boolean(value && (value === "currentcolor" || systemColorIdentifiers.has(value))))
    );
  });
  let deterministic = false;
  if (!requiresBrowserContext) {
    try {
      deterministic = utils.isColor(expression, {
        colorScheme: options.declaredScheme,
        ...(customProperty ? { customProperty } : {}),
      });
    } catch {
      deterministic = false;
    }
  }

  if (deterministic) {
    return { valid: true, kind: "deterministic", expression };
  }

  if (first[0] === TokenType.Function) {
    if (!rootName || knownNonColorRootFunctions.has(rootName)) {
      return expressionDiagnostic(path, "EXPRESSION_NOT_COLOR", "表达式是已知的非颜色 CSS 函数。");
    }
    return { valid: true, kind: "browser-only", expression };
  }

  if (first[0] === TokenType.Ident && rootName && !knownNonColorIdentifiers.has(rootName)) {
    return { valid: true, kind: "browser-only", expression };
  }

  return expressionDiagnostic(path, "EXPRESSION_NOT_COLOR", "表达式不是受支持的 CSS 颜色值。");
}

export function computeBrowserValidationDigests(
  tokens: ThemeTokenMap,
  validationCanvas: FormalThemePayloadV1["validationCanvas"],
  declaredScheme: DeclaredScheme,
): {
  expressionSetDigest: string;
  tokenContextDigest: string;
  expressionDigests: Record<ThemeTokenName, string>;
} {
  return {
    expressionSetDigest: digest(canonicalExpressionSetInput(tokens)),
    tokenContextDigest: digest(canonicalTokenContextInput(tokens, validationCanvas, declaredScheme)),
    expressionDigests: Object.fromEntries(
      THEME_TOKEN_NAMES.map((name) => [name, digest(tokens[name].expression)]),
    ) as Record<ThemeTokenName, string>,
  };
}

function validateBrowserReport(
  tokens: ThemeTokenMap,
  validationCanvas: FormalThemePayloadV1["validationCanvas"],
  declaredScheme: DeclaredScheme,
  report: BrowserValidationReportV1 | null,
): AppearanceDiagnostic[] {
  if (!report) {
    return [{
      path: "browserValidation",
      code: "BROWSER_VALIDATION_REQUIRED",
      message: "当前配色包含服务端无法确定解析的表达式，需要当前浏览器重新验证。",
    }];
  }

  const expected = computeBrowserValidationDigests(tokens, validationCanvas, declaredScheme);
  const mismatched =
    report.declaredScheme !== declaredScheme ||
    report.expressionSetDigest !== expected.expressionSetDigest ||
    report.tokenContextDigest !== expected.tokenContextDigest ||
    THEME_TOKEN_NAMES.some((name) => report.results[name]?.expressionDigest !== expected.expressionDigests[name]);

  return mismatched
    ? [{
        path: "browserValidation",
        code: "BROWSER_VALIDATION_MISMATCH",
        message: "浏览器验证报告与当前表达式、回退色、画布或主题类型不匹配。",
      }]
    : [];
}

export function validateFormalTheme(
  payload: unknown,
  declaredScheme: DeclaredScheme,
): { success: true; payload: FormalThemePayloadV1 } | { success: false; diagnostics: AppearanceDiagnostic[] } {
  const parsed = formalThemePayloadV1Schema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      diagnostics: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.path.at(-1) === "fallback" ? "FALLBACK_INVALID" : issue.path.includes("validationCanvas") ? "CANVAS_INVALID" : "PAYLOAD_INVALID",
        message: issue.message,
      })),
    };
  }

  const diagnostics: AppearanceDiagnostic[] = [];
  let browserOnly = false;

  for (const name of THEME_TOKEN_NAMES) {
    const validation = validateCssColorExpression(parsed.data.tokens[name].expression, {
      path: `tokens.${name}.expression`,
      declaredScheme,
      tokens: parsed.data.tokens,
    });
    if (!validation.valid) diagnostics.push(validation.diagnostic);
    else if (validation.kind === "browser-only") browserOnly = true;
  }

  const cyclicTokens = findCyclicThemeTokens(parsed.data.tokens);
  for (const name of cyclicTokens) {
    diagnostics.push({
      path: `tokens.${name}.expression`,
      code: "EXPRESSION_CYCLE",
      message: "主题颜色变量不能形成自引用或多令牌循环。",
    });
  }

  // A supplied report must always describe the exact final payload, even when
  // all expressions are deterministic. This prevents stale portable metadata
  // from surviving a token/fallback/canvas/scheme change unnoticed.
  if (browserOnly || parsed.data.browserValidation) {
    diagnostics.push(
      ...validateBrowserReport(
        parsed.data.tokens,
        parsed.data.validationCanvas,
        declaredScheme,
        parsed.data.browserValidation,
      ),
    );
  }

  diagnostics.push(...validateThemeContrast(parsed.data.tokens, parsed.data.validationCanvas.color));

  return diagnostics.length > 0
    ? { success: false, diagnostics }
    : { success: true, payload: parsed.data };
}

export function validateLooseThemeSnapshot(
  payload: unknown,
): { success: true; payload: LooseThemeSnapshotV1 } | { success: false; diagnostics: AppearanceDiagnostic[] } {
  const parsed = looseThemeSnapshotV1Schema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      diagnostics: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: "PAYLOAD_INVALID",
        message: issue.message,
      })),
    };
  }

  const diagnostics: AppearanceDiagnostic[] = [];
  for (const [name, value] of Object.entries(parsed.data.tokens)) {
    for (const [field, text] of [["expression", value.expression], ["fallback", value.fallback]] as const) {
      if (Buffer.byteLength(text, "utf8") > APPEARANCE_TECHNICAL_LIMITS.expressionBytes) {
        diagnostics.push({
          path: `tokens.${name}.${field}`,
          code: "EXPRESSION_TOO_LARGE",
          message: "编辑字段超过技术长度限制。",
        });
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
        diagnostics.push({
          path: `tokens.${name}.${field}`,
          code: "EXPRESSION_UNSAFE",
          message: "编辑字段包含不安全控制字符。",
        });
      }
    }
  }

  return diagnostics.length > 0
    ? { success: false, diagnostics }
    : { success: true, payload: parsed.data };
}
