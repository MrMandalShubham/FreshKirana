CREATE TABLE "cart"."cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"anon_id" text,
	"vendor_id" uuid,
	"substitution_preference" text DEFAULT 'AUTO_SUBSTITUTE' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_has_an_owner" CHECK ("cart"."cart"."account_id" is not null or "cart"."cart"."anon_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "cart"."cart_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"vendor_offer_id" uuid NOT NULL,
	"master_product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"added_at_price_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_line_quantity_positive" CHECK ("cart"."cart_line"."quantity" > 0),
	CONSTRAINT "cart_line_price_positive" CHECK ("cart"."cart_line"."added_at_price_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "cart"."cart_line" ADD CONSTRAINT "cart_line_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "cart"."cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_active_account_key" ON "cart"."cart" USING btree ("account_id") WHERE "cart"."cart"."status" = 'ACTIVE' and "cart"."cart"."account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_active_anon_key" ON "cart"."cart" USING btree ("anon_id") WHERE "cart"."cart"."status" = 'ACTIVE' and "cart"."cart"."anon_id" is not null;--> statement-breakpoint
CREATE INDEX "cart_vendor_idx" ON "cart"."cart" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_line_offer_key" ON "cart"."cart_line" USING btree ("cart_id","vendor_offer_id");--> statement-breakpoint
CREATE INDEX "cart_line_cart_idx" ON "cart"."cart_line" USING btree ("cart_id");