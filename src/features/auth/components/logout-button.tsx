"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { AUTH_SESSION_CLEARED_EVENT } from "@/lib/auth/auth-events";
import { signedOutDataSchema } from "@/features/auth/schemas/login-schema";
import { browserApiRequest } from "@/lib/api/browser-api";
import { replaceDocument } from "@/lib/navigation/full-document";

export function LogoutButton() {
  const [isPending, setIsPending] = useState(false);

  async function handleLogout() {
    setIsPending(true);
    try {
      await browserApiRequest("/api/auth/logout", signedOutDataSchema, { method: "POST" });
      window.dispatchEvent(new Event(AUTH_SESSION_CLEARED_EVENT));
      replaceDocument("/login");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isPending}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-muted hover:text-foreground disabled:opacity-60"
    >
      <LogOut aria-hidden className="size-4" />
      {isPending ? "退出中" : "退出"}
    </button>
  );
}
