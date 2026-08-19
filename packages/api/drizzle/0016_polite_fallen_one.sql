CREATE TABLE "inventory"."reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_offer_id" uuid NOT NULL,
	"order_id" uuid,
	"account_id" uuid,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'HELD' NOT NULL,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"released_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_quantity_positive" CHECK ("inventory"."reservation"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_idempotency_key" ON "inventory"."reservation" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "reservation_offer_idx" ON "inventory"."reservation" USING btree ("vendor_offer_id","status");--> statement-breakpoint
CREATE INDEX "reservation_order_idx" ON "inventory"."reservation" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reservation_expiry_idx" ON "inventory"."reservation" USING btree ("status","expires_at");