CREATE TABLE "appearance_configs" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'system' NOT NULL,
	"light_theme_id" uuid,
	"dark_theme_id" uuid,
	"recovery_shortcut" jsonb,
	"escape_recovery_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appearance_configs_mode_check" CHECK ("appearance_configs"."mode" IN ('light', 'dark', 'system'))
);
--> statement-breakpoint
CREATE TABLE "appearance_leases" (
	"row_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"resource_kind" text NOT NULL,
	"theme_id" uuid,
	"lease_id" uuid,
	"holder_token_hash" text,
	"lock_epoch" bigint DEFAULT 0 NOT NULL,
	"fence" bigint DEFAULT 0 NOT NULL,
	"acquired_at" timestamp with time zone,
	"renewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"requires_draft_resolution" boolean DEFAULT false NOT NULL,
	CONSTRAINT "appearance_leases_kind_check" CHECK ("appearance_leases"."resource_kind" IN ('root', 'config', 'theme')),
	CONSTRAINT "appearance_leases_theme_kind_check" CHECK (("appearance_leases"."resource_kind" = 'theme') = ("appearance_leases"."theme_id" IS NOT NULL)),
	CONSTRAINT "appearance_leases_active_fields_check" CHECK (("appearance_leases"."lease_id" IS NULL AND "appearance_leases"."holder_token_hash" IS NULL AND "appearance_leases"."expires_at" IS NULL) OR ("appearance_leases"."lease_id" IS NOT NULL AND "appearance_leases"."holder_token_hash" IS NOT NULL AND "appearance_leases"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "appearance_lock_state" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"lock_epoch" bigint DEFAULT 0 NOT NULL,
	"state_revision" bigint DEFAULT 0 NOT NULL,
	"published_revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appearance_mutation_receipts" (
	"account_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"operation_kind" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" uuid,
	"request_digest" text NOT NULL,
	"safe_result" jsonb NOT NULL,
	"state_revision" bigint NOT NULL,
	"published_revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "appearance_mutation_receipts_account_id_operation_id_pk" PRIMARY KEY("account_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "appearance_restore_plans" (
	"plan_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"format_version" integer NOT NULL,
	"canonical_payload" jsonb NOT NULL,
	"payload_digest" text NOT NULL,
	"expected_state_revision" bigint NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_result" jsonb
);
--> statement-breakpoint
CREATE TABLE "appearance_theme_drafts" (
	"account_id" uuid NOT NULL,
	"theme_id" uuid NOT NULL,
	"contract_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"base_theme_revision" bigint NOT NULL,
	"draft_revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appearance_theme_drafts_account_id_theme_id_pk" PRIMARY KEY("account_id","theme_id")
);
--> statement-breakpoint
CREATE TABLE "appearance_themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"declared_scheme" text NOT NULL,
	"contract_version" integer NOT NULL,
	"tokens" jsonb NOT NULL,
	"validation_canvas_color" text NOT NULL,
	"browser_validation" jsonb,
	"theme_revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appearance_themes_account_id_id_unique" UNIQUE("account_id","id"),
	CONSTRAINT "appearance_themes_name_trimmed_check" CHECK (btrim("appearance_themes"."name") <> '' AND "appearance_themes"."name" = btrim("appearance_themes"."name")),
	CONSTRAINT "appearance_themes_scheme_check" CHECK ("appearance_themes"."declared_scheme" IN ('light', 'dark')),
	CONSTRAINT "appearance_themes_canvas_check" CHECK ("appearance_themes"."validation_canvas_color" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "appearance_configs" ADD CONSTRAINT "appearance_configs_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_configs" ADD CONSTRAINT "appearance_configs_light_theme_fk" FOREIGN KEY ("account_id","light_theme_id") REFERENCES "public"."appearance_themes"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_configs" ADD CONSTRAINT "appearance_configs_dark_theme_fk" FOREIGN KEY ("account_id","dark_theme_id") REFERENCES "public"."appearance_themes"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_leases" ADD CONSTRAINT "appearance_leases_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_leases" ADD CONSTRAINT "appearance_leases_theme_fk" FOREIGN KEY ("account_id","theme_id") REFERENCES "public"."appearance_themes"("account_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_lock_state" ADD CONSTRAINT "appearance_lock_state_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_mutation_receipts" ADD CONSTRAINT "appearance_mutation_receipts_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_restore_plans" ADD CONSTRAINT "appearance_restore_plans_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_theme_drafts" ADD CONSTRAINT "appearance_theme_drafts_theme_fk" FOREIGN KEY ("account_id","theme_id") REFERENCES "public"."appearance_themes"("account_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appearance_themes" ADD CONSTRAINT "appearance_themes_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appearance_leases_root_unique" ON "appearance_leases" USING btree ("account_id") WHERE "appearance_leases"."resource_kind" = 'root';--> statement-breakpoint
CREATE UNIQUE INDEX "appearance_leases_config_unique" ON "appearance_leases" USING btree ("account_id") WHERE "appearance_leases"."resource_kind" = 'config';--> statement-breakpoint
CREATE UNIQUE INDEX "appearance_leases_theme_unique" ON "appearance_leases" USING btree ("account_id","theme_id") WHERE "appearance_leases"."resource_kind" = 'theme';--> statement-breakpoint
CREATE INDEX "appearance_leases_status_idx" ON "appearance_leases" USING btree ("account_id","lock_epoch","resource_kind","expires_at");--> statement-breakpoint
CREATE INDEX "appearance_receipts_expiry_idx" ON "appearance_mutation_receipts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appearance_restore_plans_account_operation_unique" ON "appearance_restore_plans" USING btree ("account_id","operation_id");--> statement-breakpoint
CREATE INDEX "appearance_restore_plans_expiry_idx" ON "appearance_restore_plans" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appearance_themes_account_name_lower_unique" ON "appearance_themes" USING btree ("account_id",lower("name"));