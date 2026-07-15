"use client";

import { useLayoutEffect, useRef } from "react";

import { applyThemeToScope, clearThemeFromScope } from "@/features/appearance/runtime/theme-runtime";
import { THEME_TOKEN_NAMES, type DeclaredScheme, type ThemeTokenMap } from "@/features/appearance/theme-contract";

function safePreviewTokens(tokens: ThemeTokenMap, savedTokens: ThemeTokenMap): ThemeTokenMap {
  return Object.fromEntries(
    THEME_TOKEN_NAMES.map((name) => [
      name,
      {
        expression: tokens[name].expression,
        fallback: /^#[0-9a-f]{8}$/.test(tokens[name].fallback)
          ? tokens[name].fallback
          : savedTokens[name].fallback,
      },
    ]),
  ) as ThemeTokenMap;
}

export function ThemePreview({
  tokens,
  savedTokens,
  scheme,
}: {
  tokens: ThemeTokenMap;
  savedTokens: ThemeTokenMap;
  scheme: DeclaredScheme;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scope = ref.current;
    if (!scope) return;
    applyThemeToScope(scope, safePreviewTokens(tokens, savedTokens), scheme);
    return () => clearThemeFromScope(scope);
  }, [savedTokens, scheme, tokens]);

  return (
    <div
      ref={ref}
      data-testid="theme-preview"
      className="appearance-scope overflow-hidden rounded-xl border border-border bg-background shadow-[var(--shadow)]"
    >
      <div className="grid min-h-80 sm:grid-cols-[10rem_1fr]">
        <aside className="border-r border-border bg-surface-muted p-4">
          <p className="text-xs font-bold text-subtle">预览</p>
          <div className="mt-5 space-y-2 text-sm">
            <div className="rounded-lg bg-surface-selected px-3 py-2 font-semibold">收件箱</div>
            <div className="rounded-lg px-3 py-2 text-muted">未读文章</div>
            <div className="rounded-lg px-3 py-2 text-muted">收藏</div>
          </div>
        </aside>
        <section className="bg-surface-raised p-5 sm:p-7">
          <p className="text-xs font-bold text-accent uppercase">Example Engineering</p>
          <h2 className="mt-3 font-serif text-3xl font-semibold">让阅读回到安静之中</h2>
          <p className="mt-3 leading-7 text-muted">清晨的更新已经汇入收件箱，稍后可以继续昨天未读完的文章。</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className="rounded-lg bg-control-background px-4 py-2 font-semibold text-control-foreground">主要操作</button>
            <button type="button" className="rounded-lg border border-border-strong bg-surface px-4 py-2">次要操作</button>
            <button
              type="button"
              data-testid="theme-preview-danger-action"
              className="rounded-lg bg-danger-background px-4 py-2 font-semibold text-danger-foreground"
            >
              危险操作
            </button>
          </div>
          <label className="mt-5 block text-sm font-medium">
            示例输入
            <input className="mt-2 h-10 w-full rounded-lg border border-border bg-surface px-3" placeholder="占位文字" />
          </label>
          <p className="mt-5 text-sm text-success">保存成功状态</p>
          <p className="mt-1 text-sm text-danger">校验失败状态</p>
          <p className="mt-5 font-serif leading-7">文章中的 <a className="text-article-link underline decoration-article-link-decoration" href="#preview">链接</a> 与 <mark className="bg-article-mark-background text-article-mark-foreground">高亮标记</mark>。</p>
        </section>
      </div>
    </div>
  );
}
