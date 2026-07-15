"use client";

import { ChevronDown, LoaderCircle, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { z } from "zod";

import { ModalDialog } from "@/features/appearance/components/modal-dialog";
import {
  themeListDataSchema,
  type DeclaredScheme,
} from "@/features/appearance/schemas/appearance-schema";
import { browserApiRequest } from "@/lib/api/browser-api";

type ThemeSummary = z.infer<typeof themeListDataSchema>["items"][number];

type ThemePage = {
  items: ThemeSummary[];
  nextCursor: string | null;
};

export type ThemePickerSelection =
  | { kind: "builtin"; scheme: DeclaredScheme }
  | {
      kind: "custom";
      themeId: string;
      name: string;
      declaredScheme: DeclaredScheme;
    };

export type ThemePageLoader = (options: {
  query: string;
  cursor: string | null;
  scheme: DeclaredScheme | null;
}) => Promise<ThemePage>;

async function defaultThemePageLoader(options: {
  query: string;
  cursor: string | null;
  scheme: DeclaredScheme | null;
}): Promise<ThemePage> {
  const params = new URLSearchParams();
  if (options.query) params.set("query", options.query);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.scheme) params.set("scheme", options.scheme);
  return browserApiRequest(`/api/appearance/themes?${params}`, themeListDataSchema);
}

function selectionLabel(selection: ThemePickerSelection): string {
  if (selection.kind === "builtin") return selection.scheme === "light" ? "内置明亮" : "内置暗色";
  return `${selection.name}（${selection.declaredScheme === "light" ? "明" : "暗"}）`;
}

function mergeThemes(current: ThemeSummary[], incoming: ThemeSummary[]): ThemeSummary[] {
  const byId = new Map(current.map((theme) => [theme.id, theme]));
  for (const theme of incoming) byId.set(theme.id, theme);
  return [...byId.values()];
}

export function SearchableThemePicker({
  label,
  value,
  onChange,
  allowedScheme = null,
  builtinSchemes = ["light", "dark"],
  loadPage = defaultThemePageLoader,
}: {
  label: string;
  value: ThemePickerSelection;
  onChange: (selection: ThemePickerSelection) => void;
  allowedScheme?: DeclaredScheme | null;
  builtinSchemes?: readonly DeclaredScheme[];
  loadPage?: ThemePageLoader;
}) {
  const panelId = useId();
  const requestSequence = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => {
    requestSequence.current += 1;
  }, []);

  async function load(cursor: string | null, nextQuery: string, append: boolean) {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const page = await loadPage({ query: nextQuery, cursor, scheme: allowedScheme });
      if (sequence !== requestSequence.current) return;
      setThemes((current) => append ? mergeThemes(current, page.items) : page.items);
      setNextCursor(page.nextCursor);
      setAppliedQuery(nextQuery);
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setError(caught instanceof Error ? caught.message : "主题列表加载失败。");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) void load(null, "", false);
  }

  function choose(selection: ThemePickerSelection) {
    onChange(selection);
    setOpen(false);
  }

  return (
    <div className="min-w-0 text-sm font-semibold">
      <span>{label}</span>
      <button
        type="button"
        aria-label={`${label}：${selectionLabel(value)}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 text-left"
      >
        <span className="min-w-0 truncate">{selectionLabel(value)}</span>
        <ChevronDown aria-hidden className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div id={panelId} className="mt-2 rounded-lg border border-border bg-background p-3 shadow-[var(--shadow-control)]">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`${panelId}-search`}>搜索{label}</label>
            <input
              id={`${panelId}-search`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void load(null, query.trim(), false);
                }
              }}
              placeholder="搜索主题名称"
              className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 font-normal"
            />
            <button
              type="button"
              aria-label={`搜索${label}`}
              title="搜索"
              onClick={() => void load(null, query.trim(), false)}
              className="grid size-11 shrink-0 place-items-center rounded-lg border border-border hover:bg-surface-hover"
            >
              <Search aria-hidden className="size-4" />
            </button>
          </div>

          <div className="mt-3 grid gap-2" role="group" aria-label={`${label}选项`}>
            {builtinSchemes.map((scheme) => (
              <button
                key={`builtin-${scheme}`}
                type="button"
                aria-pressed={value.kind === "builtin" && value.scheme === scheme}
                onClick={() => choose({ kind: "builtin", scheme })}
                className="min-h-11 rounded-lg px-3 text-left hover:bg-surface-hover aria-pressed:bg-surface-selected"
              >
                {scheme === "light" ? "内置明亮" : "内置暗色"}
              </button>
            ))}
            {themes.map((theme) => (
              <button
                key={theme.id}
                type="button"
                aria-pressed={value.kind === "custom" && value.themeId === theme.id}
                onClick={() => choose({
                  kind: "custom",
                  themeId: theme.id,
                  name: theme.name,
                  declaredScheme: theme.declaredScheme,
                })}
                className="min-h-11 truncate rounded-lg px-3 text-left hover:bg-surface-hover aria-pressed:bg-surface-selected"
                title={`${theme.name}（${theme.declaredScheme === "light" ? "明" : "暗"}）`}
              >
                {theme.name}（{theme.declaredScheme === "light" ? "明" : "暗"}）
              </button>
            ))}
          </div>

          {themes.length === 0 && !loading ? (
            <p className="px-3 py-3 font-normal text-muted">{appliedQuery ? "没有匹配的自定义主题。" : "还没有自定义主题。"}</p>
          ) : null}
          {error ? <p role="alert" className="mt-2 text-danger">{error}</p> : null}
          {loading ? <p role="status" className="mt-2 flex items-center gap-2 font-normal text-muted"><LoaderCircle aria-hidden className="size-4 animate-spin" />正在加载主题…</p> : null}
          {nextCursor && !loading ? (
            <button
              type="button"
              onClick={() => void load(nextCursor, appliedQuery, true)}
              className="mt-3 min-h-11 w-full rounded-lg border border-border px-3 hover:bg-surface-hover"
            >
              加载更多主题
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ResetThemeDialog({
  target,
  source,
  busy,
  onSourceChange,
  onCancel,
  onConfirm,
  loadPage,
}: {
  target: ThemeSummary;
  source: ThemePickerSelection;
  busy: boolean;
  onSourceChange: (selection: ThemePickerSelection) => void;
  onCancel: () => void;
  onConfirm: () => void;
  loadPage?: ThemePageLoader;
}) {
  return (
    <ModalDialog
      labelledBy="reset-theme-heading"
      onClose={onCancel}
      className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-strong)]"
    >
        <h2 id="reset-theme-heading" className="min-w-0 font-serif text-3xl font-semibold [overflow-wrap:anywhere]">重置“{target.name}”</h2>
        <p className="mt-3 text-sm leading-6 text-muted">可从任意明亮或暗色的内置/自定义主题复制全部颜色。目标名称、声明类型与槽位引用保持不变。</p>
        <div className="mt-5">
          <SearchableThemePicker
            label="重置来源"
            value={source}
            onChange={onSourceChange}
            loadPage={loadPage}
          />
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-lg px-4 font-semibold hover:bg-surface-hover disabled:opacity-50">取消</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="min-h-11 rounded-lg bg-control-background px-4 font-semibold text-control-foreground disabled:opacity-50">{busy ? "正在重置" : "确认重置"}</button>
        </div>
    </ModalDialog>
  );
}
