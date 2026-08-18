CREATE TABLE "offer"."vendor_offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"master_product_id" uuid NOT NULL,
	"mrp_paise" integer NOT NULL,
	"selling_price_paise" integer NOT NULL,
	"inventory_mode" text DEFAULT 'TOGGLE' NOT NULL,
	"stock_on_hand" integer DEFAULT 0 NOT NULL,
	"stock_reserved" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"batch_no" text,
	"mfg_date" date,
	"expiry_date" date,
	"slot_availability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_offer_mrp_positive" CHECK ("offer"."vendor_offer"."mrp_paise" > 0),
	CONSTRAINT "vendor_offer_price_positive" CHECK ("offer"."vendor_offer"."selling_price_paise" > 0),
	CONSTRAINT "vendor_offer_price_not_above_mrp" CHECK ("offer"."vendor_offer"."selling_price_paise" <= "offer"."vendor_offer"."mrp_paise"),
	CONSTRAINT "vendor_offer_stock_non_negative" CHECK ("offer"."vendor_offer"."stock_on_hand" >= 0),
	CONSTRAINT "vendor_offer_reserved_non_negative" CHECK ("offer"."vendor_offer"."stock_reserved" >= 0),
	CONSTRAINT "vendor_offer_reserved_within_stock" CHECK ("offer"."vendor_offer"."stock_reserved" <= "offer"."vendor_offer"."stock_on_hand"),
	CONSTRAINT "vendor_offer_expiry_after_mfg" CHECK ("offer"."vendor_offer"."mfg_date" is null or "offer"."vendor_offer"."expiry_date" is null or "offer"."vendor_offer"."expiry_date" >= "offer"."vendor_offer"."mfg_date")
);
--> statement-breakpoint
CREATE TABLE "vendor"."vendor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"address_line" text NOT NULL,
	"city" text NOT NULL,
	"pincode" text NOT NULL,
	"gst_registration_type" text DEFAULT 'UNREGISTERED' NOT NULL,
	"gstin" text,
	"fssai_licence_no" text,
	"fssai_expiry_date" date,
	"default_inventory_mode" text DEFAULT 'TOGGLE' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"suspension_reason" text,
	"store_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_gstin_present_when_registered" CHECK ("vendor"."vendor"."gst_registration_type" <> 'REGISTERED' or ("vendor"."vendor"."gstin" is not null and btrim("vendor"."vendor"."gstin") <> '')),
	CONSTRAINT "vendor_gstin_shape" CHECK ("vendor"."vendor"."gstin" is null or "vendor"."vendor"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'),
	CONSTRAINT "vendor_pincode_shape" CHECK ("vendor"."vendor"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "vendor_fssai_required_when_active" CHECK ("vendor"."vendor"."status" <> 'ACTIVE' or ("vendor"."vendor"."fssai_licence_no" is not null and btrim("vendor"."vendor"."fssai_licence_no") <> ''))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_offer_unique" ON "offer"."vendor_offer" USING btree ("vendor_id","master_product_id");--> statement-breakpoint
CREATE INDEX "vendor_offer_product_idx" ON "offer"."vendor_offer" USING btree ("master_product_id","status");--> statement-breakpoint
CREATE INDEX "vendor_offer_vendor_idx" ON "offer"."vendor_offer" USING btree ("vendor_id","status");--> statement-breakpoint
CREATE INDEX "vendor_offer_low_stock_idx" ON "offer"."vendor_offer" USING btree ("vendor_id") WHERE "offer"."vendor_offer"."stock_on_hand" <= "offer"."vendor_offer"."low_stock_threshold";--> statement-breakpoint
CREATE INDEX "vendor_offer_expiry_idx" ON "offer"."vendor_offer" USING btree ("expiry_date") WHERE "offer"."vendor_offer"."expiry_date" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_slug_key" ON "vendor"."vendor" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "vendor_status_idx" ON "vendor"."vendor" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vendor_pincode_idx" ON "vendor"."vendor" USING btree ("pincode");