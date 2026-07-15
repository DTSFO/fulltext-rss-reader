"use client";

import { ModalDialog } from "@/features/appearance/components/modal-dialog";
import type { DeclaredScheme } from "@/features/appearance/schemas/appearance-schema";

export function RenameThemeDialog({
  themeName,
  value,
  busy,
  message,
  messageIsError,
  onChange,
  onCancel,
  onConfirm,
}: {
  themeName: string;
  value: string;
  busy: boolean;
  message: string;
  messageIsError: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalDialog
      labelledBy="rename-theme-heading"
      onClose={onCancel}
      className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-strong)]"
    >
      <form onSubmit={(event) => { event.preventDefault(); onConfirm(); }}>
        <h2 id="rename-theme-heading" className="min-w-0 font-serif text-3xl font-semibold [overflow-wrap:anywhere]">重命名“{themeName}”</h2>
        <label className="mt-5 block text-sm font-semibold">
          新名称
          <input
            required
            data-dialog-initial-focus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3"
          />
        </label>
        <p className={messageIsError ? "mt-3 min-h-6 text-sm text-danger" : "mt-3 min-h-6 text-sm text-muted"} role="status" aria-live="polite">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg px-4 py-2 font-semibold hover:bg-surface-hover disabled:opacity-60">取消</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-control-background px-4 py-2 font-semibold text-control-foreground disabled:opacity-60">确认重命名</button>
        </div>
      </form>
    </ModalDialog>
  );
}

export function ThemeImpactDialog({
  kind,
  themeName,
  targetScheme,
  affectedSlots,
  currentlyActive,
  hasDraft,
  busy,
  message,
  messageIsError,
  onCancel,
  onConfirm,
}: {
  kind: "change-scheme" | "delete";
  themeName: string;
  targetScheme?: DeclaredScheme;
  affectedSlots: DeclaredScheme[];
  currentlyActive: boolean;
  hasDraft: boolean;
  busy: boolean;
  message: string;
  messageIsError: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const deleting = kind === "delete";
  const heading = deleting
    ? `删除“${themeName}”`
    : `切换“${themeName}”为${targetScheme === "light" ? "明亮" : "暗色"}主题`;
  const slotNames = affectedSlots.map((scheme) => scheme === "light" ? "明亮槽" : "暗色槽");

  return (
    <ModalDialog
      labelledBy="theme-impact-heading"
      onClose={onCancel}
      className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-strong)]"
    >
      <h2 id="theme-impact-heading" className="min-w-0 font-serif text-3xl font-semibold [overflow-wrap:anywhere]">{heading}</h2>
      <dl className="mt-5 grid grid-cols-[8rem_1fr] gap-3 rounded-lg bg-surface-muted p-4 text-sm">
        <dt className="font-semibold">槽位影响</dt>
        <dd>{slotNames.length > 0 ? slotNames.join("、") : "无"}</dd>
        <dt className="font-semibold">当前生效</dt>
        <dd>{currentlyActive ? "是" : "否"}</dd>
        {hasDraft ? <><dt className="font-semibold">现有草稿</dt><dd>{deleting ? "将随主题删除" : "保留"}</dd></> : null}
      </dl>
      <p className="mt-4 text-sm leading-6 text-muted">
        {deleting
          ? "受影响槽位会回退到对应内置主题，顶层模式保持不变。"
          : "源槽会回退到同类型内置主题，目标槽会改为此主题；若它当前生效，模式会随新类型切换。"}
      </p>
      <p className={messageIsError ? "mt-3 min-h-6 text-sm text-danger" : "mt-3 min-h-6 text-sm text-muted"} role="status" aria-live="polite">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" data-dialog-initial-focus disabled={busy} onClick={onCancel} className="rounded-lg px-4 py-2 font-semibold hover:bg-surface-hover disabled:opacity-60">取消</button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-lg bg-danger-background px-4 py-2 font-semibold text-danger-foreground disabled:opacity-60"
        >
          {deleting ? "确认删除" : "确认迁移"}
        </button>
      </div>
    </ModalDialog>
  );
}
