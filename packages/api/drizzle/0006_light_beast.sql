CREATE TABLE "catalog"."product_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"requested_by_account_id" uuid,
	"ean_barcode" text,
	"proposed_name" text NOT NULL,
	"proposed_brand" text,
	"proposed_net_quantity" integer,
	"proposed_uom" text,
	"category_hint" text,
	"notes" text,
	"images" text[] DEFAULT '{}'::text[] NOT NULL,
	"desired_mrp_paise" integer,
	"desired_selling_price_paise" integer,
	"desired_stock_on_hand" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"resolved_master_product_id" uuid,
	"reviewer_notes" text,
	"reviewed_by_account_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_request_resolution_coherent" CHECK (
        ("catalog"."product_request"."status" = 'PENDING' and "catalog"."product_request"."resolved_master_product_id" is null)
        or ("catalog"."product_request"."status" = 'REJECTED')
        or ("catalog"."product_request"."status" in ('APPROVED', 'DUPLICATE') and "catalog"."product_request"."resolved_master_product_id" is not null)
      ),
	CONSTRAINT "product_request_price_within_mrp" CHECK (
        "catalog"."product_request"."desired_mrp_paise" is null
        or "catalog"."product_request"."desired_selling_price_paise" is null
        or "catalog"."product_request"."desired_selling_price_paise" <= "catalog"."product_request"."desired_mrp_paise"
      )
);
--> statement-breakpoint
CREATE INDEX "product_request_status_idx" ON "catalog"."product_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "product_request_vendor_idx" ON "catalog"."product_request" USING btree ("vendor_id","status");--> statement-breakpoint
CREATE INDEX "product_request_ean_idx" ON "catalog"."product_request" USING btree ("ean_barcode") WHERE "catalog"."product_request"."ean_barcode" is not null;