import { SAFETY_PALETTE_V1 } from "@/features/appearance/theme-contract";

export default function SafeLayout({ children }: { children: React.ReactNode }) {
  const style = {
    "--safe-background": SAFETY_PALETTE_V1.background,
    "--safe-surface": SAFETY_PALETTE_V1.surface,
    "--safe-foreground": SAFETY_PALETTE_V1.foreground,
    "--safe-muted": SAFETY_PALETTE_V1.muted,
    "--safe-border": SAFETY_PALETTE_V1.border,
    "--safe-accent": SAFETY_PALETTE_V1.accent,
    "--safe-accent-foreground": SAFETY_PALETTE_V1.accentForeground,
    "--safe-danger": SAFETY_PALETTE_V1.danger,
    "--safe-focus": SAFETY_PALETTE_V1.focus,
  } as React.CSSProperties;
  return <div className="safe-appearance-document min-h-dvh" style={style}>{children}</div>;
}
