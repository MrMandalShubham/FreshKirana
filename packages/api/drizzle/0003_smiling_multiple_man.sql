CREATE TABLE "catalog"."brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_id" uuid,
	"display_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."master_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"brand_id" uuid,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"net_quantity" integer NOT NULL,
	"uom" text NOT NULL,
	"is_variable_weight" boolean DEFAULT false NOT NULL,
	"pricing_uom" text,
	"weight_tolerance_pct" integer DEFAULT 10 NOT NULL,
	"is_prepackaged" boolean DEFAULT true NOT NULL,
	"ean_barcode" text,
	"hsn_code" text NOT NULL,
	"gst_rate_bp" integer NOT NULL,
	"veg_mark" text DEFAULT 'VEG' NOT NULL,
	"manufacturer_packer" text,
	"country_of_origin" text,
	"consumer_care_contact" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"images" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_product_legal_metrology" CHECK (
        "catalog"."master_product"."status" <> 'ACTIVE'
        or "catalog"."master_product"."is_prepackaged" = false
        or (
          "catalog"."master_product"."manufacturer_packer" is not null and btrim("catalog"."master_product"."manufacturer_packer") <> ''
          and "catalog"."master_product"."country_of_origin" is not null and btrim("catalog"."master_product"."country_of_origin") <> ''
          and "catalog"."master_product"."consumer_care_contact" is not null and btrim("catalog"."master_product"."consumer_care_contact") <> ''
        )
      ),
	CONSTRAINT "master_product_net_quantity_positive" CHECK ("catalog"."master_product"."net_quantity" > 0),
	CONSTRAINT "master_product_gst_rate_sane" CHECK ("catalog"."master_product"."gst_rate_bp" >= 0 and "catalog"."master_product"."gst_rate_bp" <= 5000),
	CONSTRAINT "master_product_hsn_shape" CHECK ("catalog"."master_product"."hsn_code" ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'),
	CONSTRAINT "master_product_variable_weight_pricing" CHECK ("catalog"."master_product"."is_variable_weight" = false or "catalog"."master_product"."pricing_uom" is not null)
);
--> statement-breakpoint
ALTER TABLE "catalog"."master_product" ADD CONSTRAINT "master_product_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "catalog"."brand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."master_product" ADD CONSTRAINT "master_product_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "catalog"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_slug_key" ON "catalog"."brand" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "category_slug_key" ON "catalog"."category" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "category_parent_idx" ON "catalog"."category" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "master_product_slug_key" ON "catalog"."master_product" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "master_product_ean_key" ON "catalog"."master_product" USING btree ("ean_barcode") WHERE "catalog"."master_product"."ean_barcode" is not null;--> statement-breakpoint
CREATE INDEX "master_product_category_idx" ON "catalog"."master_product" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "master_product_brand_idx" ON "catalog"."master_product" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "master_product_status_idx" ON "catalog"."master_product" USING btree ("status");