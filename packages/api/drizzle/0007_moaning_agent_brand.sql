CREATE TABLE "search"."product_index" (
	"master_product_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brand" text,
	"category_id" uuid NOT NULL,
	"net_quantity" integer NOT NULL,
	"uom" text NOT NULL,
	"veg_mark" text NOT NULL,
	"image_url" text,
	"product_status" text NOT NULL,
	"min_price_paise" integer,
	"mrp_paise" integer,
	"is_available" boolean DEFAULT false NOT NULL,
	"offer_count" integer DEFAULT 0 NOT NULL,
	"quantity_mode_offer_count" integer DEFAULT 0 NOT NULL,
	"search_text" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search"."synonym" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"expansions" text[] NOT NULL,
	"locale" text,
	"kind" text DEFAULT 'REGIONAL_NAME' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "product_index_available_idx" ON "search"."product_index" USING btree ("is_available","min_price_paise");--> statement-breakpoint
CREATE INDEX "product_index_category_idx" ON "search"."product_index" USING btree ("category_id","is_available");--> statement-breakpoint
CREATE INDEX "product_index_status_idx" ON "search"."product_index" USING btree ("product_status");--> statement-breakpoint
CREATE UNIQUE INDEX "synonym_term_locale_key" ON "search"."synonym" USING btree ("term",coalesce("locale", '*'));--> statement-breakpoint
CREATE INDEX "synonym_active_idx" ON "search"."synonym" USING btree ("is_active");