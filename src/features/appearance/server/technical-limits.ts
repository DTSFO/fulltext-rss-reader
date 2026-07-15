import "server-only";

export const APPEARANCE_TECHNICAL_LIMITS = {
  expressionBytes: 16 * 1024,
  expressionNesting: 64,
  themeRequestBytes: 2 * 1024 * 1024,
  packageRequestBytes: 64 * 1024 * 1024,
  listDefault: 50,
  listMaximum: 100,
  cursorCharacters: 2_048,
  searchCharacters: 256,
  gateLockTimeoutMs: 2_000,
  statementTimeoutMs: 30_000,
  snapshotTimeoutMs: 120_000,
  restoreInsertBatch: 250,
  leaseSeconds: 120,
  leaseHeartbeatMs: 30_000,
  restorePlanMinutes: 30,
  mutationReceiptHours: 24,
  restoreReceiptDays: 7,
  cleanupBatch: 100,
} as const;
