"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { appearanceMutationRequest } from "@/features/appearance/appearance-client";
import { recoveryDataSchema } from "@/features/appearance/schemas/appearance-schema";
import { BrowserApiError } from "@/lib/api/browser-api";

export function RecoveryPanel() {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function recover() {
    setState("saving");
    setErrorMessage("");
    try {
      const operationId = crypto.randomUUID();
      await appearanceMutationRequest("/api/appearance/recovery", recoveryDataSchema, {
        method: "POST",
        body: JSON.stringify({ operationId }),
      });
      setState("saved");
    } catch (caught) {
      setState("error");
      const message = caught instanceof Error ? caught.message : "恢复失败，请检查网络并重试。";
      setErrorMessage(caught instanceof BrowserApiError && caught.requestId
        ? `${message}（请求编号：${caught.requestId}）`
        : message);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl items-center px-5 py-12">
      <section className="w-full rounded-xl border-2 border-[var(--safe-border)] bg-[var(--safe-surface)] p-6 shadow-[0_8px_0_var(--safe-border)] sm:p-10">
        <ShieldCheck aria-hidden className="size-10 text-[var(--safe-accent)]" />
        <h1 className="mt-6 text-4xl font-bold">安全恢复外观</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--safe-muted)]">
          恢复会将模式和明暗槽切回内置“跟随系统”，自定义主题与草稿仍会保留。其他设备上正在进行的外观编辑将停止。
        </p>
        <button
          type="button"
          onClick={recover}
          disabled={state === "saving" || state === "saved"}
          className="mt-8 min-h-12 rounded-lg border-2 border-[var(--safe-border)] bg-[var(--safe-accent)] px-6 font-bold text-[var(--safe-accent-foreground)] disabled:opacity-60"
        >
          {state === "saving" ? "正在恢复…" : state === "saved" ? "已恢复" : "切回内置跟随系统"}
        </button>
        <p className="mt-5 min-h-7 font-semibold" role="status" aria-live="polite">
          {state === "saved" ? "恢复完成。你可以返回阅读器。" : state === "error" ? errorMessage : ""}
        </p>
        <a className="mt-4 inline-block font-bold text-[var(--safe-accent)] underline" href="/reader">返回阅读器</a>
      </section>
    </main>
  );
}
