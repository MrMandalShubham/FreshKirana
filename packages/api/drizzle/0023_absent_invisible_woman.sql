CREATE TABLE "offer"."offer_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_offer_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"mfg_date" date,
	"expiry_date" date,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"remaining_quantity" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_batch_dates_ordered" CHECK ("offer"."offer_batch"."mfg_date" is null or "offer"."offer_batch"."expiry_date" is null or "offer"."offer_batch"."expiry_date" >= "offer"."offer_batch"."mfg_date"),
	CONSTRAINT "offer_batch_remaining_sane" CHECK ("offer"."offer_batch"."remaining_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order"."order_line" ADD COLUMN "offer_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "offer"."offer_batch" ADD CONSTRAINT "offer_batch_vendor_offer_id_vendor_offer_id_fk" FOREIGN KEY ("vendor_offer_id") REFERENCES "offer"."vendor_offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_batch_unique" ON "offer"."offer_batch" USING btree ("vendor_offer_id","batch_no");--> statement-breakpoint
CREATE INDEX "offer_batch_fefo_idx" ON "offer"."offer_batch" USING btree ("vendor_offer_id","status","expiry_date");--> statement-breakpoint
CREATE INDEX "offer_batch_expiry_idx" ON "offer"."offer_batch" USING btree ("expiry_date") WHERE "offer"."offer_batch"."expiry_date" is not null;--> statement-breakpoint
CREATE INDEX "order_line_batch_idx" ON "order"."order_line" USING btree ("offer_batch_id") WHERE "order"."order_line"."offer_batch_id" is not null;