CREATE TABLE "article_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"starred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"summary" text,
	"feed_content_html" text,
	"extracted_content_html" text,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"extraction_error_code" text,
	"extraction_attempted_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_categories" (
	"feed_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "feed_categories_feed_id_category_id_pk" PRIMARY KEY("feed_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"site_url" text,
	"description" text,
	"icon_url" text,
	"refresh_failures" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"last_fetched_at" timestamp with time zone,
	"next_refresh_at" timestamp with time zone,
	"refresh_lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_states" ADD CONSTRAINT "article_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_states" ADD CONSTRAINT "article_states_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_categories" ADD CONSTRAINT "feed_categories_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_categories" ADD CONSTRAINT "feed_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_states_user_article_unique" ON "article_states" USING btree ("user_id","article_id");--> statement-breakpoint
CREATE INDEX "article_states_user_unread_idx" ON "article_states" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "article_states_user_starred_idx" ON "article_states" USING btree ("user_id","is_starred");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_feed_external_id_unique" ON "articles" USING btree ("feed_id","external_id");--> statement-breakpoint
CREATE INDEX "articles_feed_published_idx" ON "articles" USING btree ("feed_id","published_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_unique" ON "categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "feeds_user_canonical_url_unique" ON "feeds" USING btree ("user_id","canonical_url");--> statement-breakpoint
CREATE INDEX "feeds_next_refresh_idx" ON "feeds" USING btree ("next_refresh_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");