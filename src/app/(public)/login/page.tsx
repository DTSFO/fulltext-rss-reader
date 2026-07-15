import { BookOpenText, Feather, Rss } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/features/auth/components/login-form";
import { getSessionUser } from "@/features/auth/server/session";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage() {
  const user = await getSessionUser();

  if (user) {
    redirect("/reader");
  }

  return (
    <main className="relative min-h-dvh overflow-hidden px-5 py-8 sm:px-8 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:p-0">
      <div aria-hidden className="editorial-grid absolute inset-0 opacity-60" />

      <section className="relative hidden min-h-dvh flex-col justify-between border-r border-border p-12 lg:flex xl:p-16">
        <div className="flex items-center gap-3 text-sm font-semibold text-muted uppercase">
          <span className="grid size-10 place-items-center rounded-full border border-border bg-surface shadow-[var(--shadow-control)]">
            <Rss aria-hidden className="size-4 text-accent" />
          </span>
          Fulltext RSS Reader
        </div>

        <div className="max-w-2xl pb-14">
          <p className="mb-5 flex items-center gap-2 text-sm font-medium text-accent">
            <Feather aria-hidden className="size-4" />
            把喧闹留在网页之外
          </p>
          <h1 className="font-serif text-6xl leading-[1.08] font-semibold xl:text-7xl">
            一处安静的地方，
            <br />
            收拢每天的阅读。
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-8 text-muted">
            聚合 RSS 与 Atom，提取干净全文，把未读、收藏和订阅重新放回你的掌控之中。
          </p>
        </div>

        <p className="text-sm text-subtle">单用户私有阅读空间 · demo.example.com</p>
      </section>

      <section className="relative flex min-h-[calc(100dvh-4rem)] items-center justify-center lg:min-h-dvh">
        <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-surface-translucent p-7 shadow-[var(--shadow)] backdrop-blur sm:p-10">
          <div className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-strong lg:hidden">
            <BookOpenText aria-hidden className="size-5" />
          </div>
          <p className="mt-6 text-sm font-semibold text-accent uppercase lg:mt-0">
            Private reader
          </p>
          <h2 className="mt-3 font-serif text-4xl font-semibold">欢迎回来</h2>
          <p className="mt-3 leading-7 text-muted">登录后继续浏览订阅、全文与收藏。</p>
          <LoginForm defaultUsername="demo-user" />
        </div>
      </section>
    </main>
  );
}
