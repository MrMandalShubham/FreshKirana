CREATE TABLE "order"."order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"account_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"status" text NOT NULL,
	"payment_status" text NOT NULL,
	"payment_method" text NOT NULL,
	"substitution_preference" text NOT NULL,
	"address_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"address_landmark" text,
	"address_city" text NOT NULL,
	"address_state" text NOT NULL,
	"address_pincode" text NOT NULL,
	"address_latitude" double precision NOT NULL,
	"address_longitude" double precision NOT NULL,
	"delivery_note" text,
	"slot_instance_id" uuid NOT NULL,
	"slot_service_date" date NOT NULL,
	"slot_starts_at" timestamp with time zone NOT NULL,
	"slot_ends_at" timestamp with time zone NOT NULL,
	"items_subtotal_paise" integer NOT NULL,
	"savings_paise" integer DEFAULT 0 NOT NULL,
	"delivery_fee_paise" integer DEFAULT 0 NOT NULL,
	"small_basket_fee_paise" integer DEFAULT 0 NOT NULL,
	"packaging_fee_paise" integer DEFAULT 0 NOT NULL,
	"grand_total_paise" integer NOT NULL,
	"tax_total_paise" integer DEFAULT 0 NOT NULL,
	"cod_collectable_paise" integer DEFAULT 0 NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_total_is_the_sum_of_its_parts" CHECK ("order"."order"."grand_total_paise" = "order"."order"."items_subtotal_paise" + "order"."order"."delivery_fee_paise" + "order"."order"."small_basket_fee_paise" + "order"."order"."packaging_fee_paise"),
	CONSTRAINT "order_amounts_not_negative" CHECK ("order"."order"."items_subtotal_paise" >= 0 and "order"."order"."grand_total_paise" >= 0 and "order"."order"."tax_total_paise" >= 0 and "order"."order"."cod_collectable_paise" >= 0),
	CONSTRAINT "order_tax_within_total" CHECK ("order"."order"."tax_total_paise" <= "order"."order"."grand_total_paise")
);
--> statement-breakpoint
CREATE TABLE "order"."order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"master_product_id" uuid NOT NULL,
	"vendor_offer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"net_quantity" integer NOT NULL,
	"uom" text NOT NULL,
	"is_variable_weight" boolean DEFAULT false NOT NULL,
	"hsn_code" text NOT NULL,
	"gst_rate_bp" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"mrp_paise" integer NOT NULL,
	"line_total_paise" integer NOT NULL,
	"line_mrp_total_paise" integer NOT NULL,
	"tax_paise" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_line_quantity_positive" CHECK ("order"."order_line"."quantity" > 0),
	CONSTRAINT "order_line_amounts_not_negative" CHECK ("order"."order_line"."unit_price_paise" >= 0 and "order"."order_line"."line_total_paise" >= 0 and "order"."order_line"."tax_paise" >= 0),
	CONSTRAINT "order_line_price_not_above_mrp" CHECK ("order"."order_line"."unit_price_paise" <= "order"."order_line"."mrp_paise")
);
--> statement-breakpoint
ALTER TABLE "order"."order_line" ADD CONSTRAINT "order_line_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "order"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_number_key" ON "order"."order" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "order_cart_key" ON "order"."order" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "order_account_idx" ON "order"."order" USING btree ("account_id","placed_at");--> statement-breakpoint
CREATE INDEX "order_vendor_idx" ON "order"."order" USING btree ("vendor_id","status");--> statement-breakpoint
CREATE INDEX "order_slot_idx" ON "order"."order" USING btree ("slot_instance_id");--> statement-breakpoint
CREATE INDEX "order_line_order_idx" ON "order"."order_line" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_line_product_idx" ON "order"."order_line" USING btree ("master_product_id");--> statement-breakpoint

-- The order number sequence. Drizzle does not model sequences, so this is
-- hand-written, and IF NOT EXISTS because CI applies migrations twice.
--
-- A sequence rather than count(*) + 1: counting races under concurrency and
-- would hand two simultaneous orders the same number, which is the one thing
-- this identifier cannot do. nextval never reuses a value even when the
-- surrounding transaction rolls back — a gap in the numbering is harmless, a
-- collision is a support case where two customers hold the same receipt.
CREATE SEQUENCE IF NOT EXISTS "order".order_number_seq AS bigint START WITH 1;
