import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const appearanceLockState = pgTable("appearance_lock_state", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lockEpoch: bigint("lock_epoch", { mode: "bigint" }).default(sql`0`).notNull(),
  stateRevision: bigint("state_revision", { mode: "bigint" }).default(sql`0`).notNull(),
  publishedRevision: bigint("published_revision", { mode: "bigint" }).default(sql`0`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const appearanceThemes = pgTable(
  "appearance_themes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    declaredScheme: text("declared_scheme").notNull(),
    contractVersion: integer("contract_version").notNull(),
    tokens: jsonb("tokens").notNull(),
    validationCanvasColor: text("validation_canvas_color").notNull(),
    browserValidation: jsonb("browser_validation"),
    themeRevision: bigint("theme_revision", { mode: "bigint" }).default(sql`0`).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("appearance_themes_account_id_id_unique").on(table.accountId, table.id),
    uniqueIndex("appearance_themes_account_name_lower_unique").on(table.accountId, sql`lower(${table.name})`),
    check("appearance_themes_name_trimmed_check", sql`btrim(${table.name}) <> '' AND ${table.name} = btrim(${table.name})`),
    check("appearance_themes_scheme_check", sql`${table.declaredScheme} IN ('light', 'dark')`),
    check("appearance_themes_canvas_check", sql`${table.validationCanvasColor} ~ '^#[0-9a-f]{6}$'`),
  ],
);

export const appearanceConfigs = pgTable(
  "appearance_configs",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode").default("system").notNull(),
    lightThemeId: uuid("light_theme_id"),
    darkThemeId: uuid("dark_theme_id"),
    recoveryShortcut: jsonb("recovery_shortcut"),
    escapeRecoveryEnabled: boolean("escape_recovery_enabled").default(true).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("appearance_configs_mode_check", sql`${table.mode} IN ('light', 'dark', 'system')`),
    foreignKey({
      name: "appearance_configs_light_theme_fk",
      columns: [table.accountId, table.lightThemeId],
      foreignColumns: [appearanceThemes.accountId, appearanceThemes.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "appearance_configs_dark_theme_fk",
      columns: [table.accountId, table.darkThemeId],
      foreignColumns: [appearanceThemes.accountId, appearanceThemes.id],
    }).onDelete("restrict"),
  ],
);

export const appearanceThemeDrafts = pgTable(
  "appearance_theme_drafts",
  {
    accountId: uuid("account_id").notNull(),
    themeId: uuid("theme_id").notNull(),
    contractVersion: integer("contract_version").notNull(),
    payload: jsonb("payload").notNull(),
    baseThemeRevision: bigint("base_theme_revision", { mode: "bigint" }).notNull(),
    draftRevision: bigint("draft_revision", { mode: "bigint" }).default(sql`1`).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.themeId] }),
    foreignKey({
      name: "appearance_theme_drafts_theme_fk",
      columns: [table.accountId, table.themeId],
      foreignColumns: [appearanceThemes.accountId, appearanceThemes.id],
    }).onDelete("cascade"),
  ],
);

export const appearanceLeases = pgTable(
  "appearance_leases",
  {
    rowId: uuid("row_id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceKind: text("resource_kind").notNull(),
    themeId: uuid("theme_id"),
    leaseId: uuid("lease_id"),
    holderTokenHash: text("holder_token_hash"),
    lockEpoch: bigint("lock_epoch", { mode: "bigint" }).default(sql`0`).notNull(),
    fence: bigint("fence", { mode: "bigint" }).default(sql`0`).notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    renewedAt: timestamp("renewed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    requiresDraftResolution: boolean("requires_draft_resolution").default(false).notNull(),
  },
  (table) => [
    check("appearance_leases_kind_check", sql`${table.resourceKind} IN ('root', 'config', 'theme')`),
    check(
      "appearance_leases_theme_kind_check",
      sql`(${table.resourceKind} = 'theme') = (${table.themeId} IS NOT NULL)`,
    ),
    check(
      "appearance_leases_active_fields_check",
      sql`(${table.leaseId} IS NULL AND ${table.holderTokenHash} IS NULL AND ${table.expiresAt} IS NULL) OR (${table.leaseId} IS NOT NULL AND ${table.holderTokenHash} IS NOT NULL AND ${table.expiresAt} IS NOT NULL)`,
    ),
    uniqueIndex("appearance_leases_root_unique")
      .on(table.accountId)
      .where(sql`${table.resourceKind} = 'root'`),
    uniqueIndex("appearance_leases_config_unique")
      .on(table.accountId)
      .where(sql`${table.resourceKind} = 'config'`),
    uniqueIndex("appearance_leases_theme_unique")
      .on(table.accountId, table.themeId)
      .where(sql`${table.resourceKind} = 'theme'`),
    index("appearance_leases_status_idx").on(table.accountId, table.lockEpoch, table.resourceKind, table.expiresAt),
    foreignKey({
      name: "appearance_leases_theme_fk",
      columns: [table.accountId, table.themeId],
      foreignColumns: [appearanceThemes.accountId, appearanceThemes.id],
    }).onDelete("cascade"),
  ],
);

export const appearanceMutationReceipts = pgTable(
  "appearance_mutation_receipts",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id").notNull(),
    operationKind: text("operation_kind").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceId: uuid("resource_id"),
    requestDigest: text("request_digest").notNull(),
    safeResult: jsonb("safe_result").notNull(),
    stateRevision: bigint("state_revision", { mode: "bigint" }).notNull(),
    publishedRevision: bigint("published_revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.operationId] }),
    index("appearance_receipts_expiry_idx").on(table.expiresAt),
  ],
);

export const appearanceRestorePlans = pgTable(
  "appearance_restore_plans",
  {
    planId: uuid("plan_id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id").notNull(),
    formatVersion: integer("format_version").notNull(),
    canonicalPayload: jsonb("canonical_payload").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    expectedStateRevision: bigint("expected_state_revision", { mode: "bigint" }).notNull(),
    summary: jsonb("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedResult: jsonb("applied_result"),
  },
  (table) => [
    uniqueIndex("appearance_restore_plans_account_operation_unique").on(table.accountId, table.operationId),
    index("appearance_restore_plans_expiry_idx").on(table.expiresAt),
  ],
);
