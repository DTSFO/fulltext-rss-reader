"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { loginDataSchema } from "@/features/auth/schemas/login-schema";
import { browserApiRequest } from "@/lib/api/browser-api";
import { replaceDocument } from "@/lib/navigation/full-document";
import { cn } from "@/lib/styling/cn";

export function LoginForm({ defaultUsername }: { defaultUsername: string }) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);

    try {
      await browserApiRequest("/api/auth/login", loginDataSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: formData.get("username"),
          password: formData.get("password"),
        }),
      });

      replaceDocument("/reader");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法连接到服务器，请检查网络后重试。");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form className="mt-9 space-y-5" onSubmit={handleSubmit}>
      <label className="block space-y-2">
        <span className="text-sm font-medium text-muted">用户名</span>
        <input
          name="username"
          autoComplete="username"
          defaultValue={defaultUsername}
          required
          className="h-12 w-full rounded-[var(--radius-sm)] border border-border bg-surface-raised px-4 text-foreground shadow-[var(--shadow-control)] transition focus:border-accent focus:outline-none"
        />
      </label>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-muted">密码</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-12 w-full rounded-[var(--radius-sm)] border border-border bg-surface-raised px-4 text-foreground shadow-[var(--shadow-control)] transition focus:border-accent focus:outline-none"
        />
      </label>

      <p
        role="alert"
        aria-live="polite"
        className={cn("min-h-6 text-sm text-danger", !error && "invisible")}
      >
        {error ?? "占位"}
      </p>

      <button
        type="submit"
        disabled={isPending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-control-background px-5 font-semibold text-control-foreground transition hover:bg-control-hover-background disabled:cursor-wait disabled:opacity-70"
      >
        {isPending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
        进入阅读器
        {!isPending ? <ArrowRight aria-hidden className="size-4" /> : null}
      </button>
    </form>
  );
}
