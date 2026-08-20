CREATE TABLE "payment"."refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"payment_id" uuid,
	"amount_paise" integer NOT NULL,
	"reason" text NOT NULL,
	"route" text NOT NULL,
	"status" text NOT NULL,
	"order_line_id" uuid,
	"provider_refund_id" text,
	"failure_reason" text,
	"idempotency_key" text NOT NULL,
	"issued_by" uuid,
	"note" text,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "refund_idempotency_key" ON "payment"."refund" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refund_order_idx" ON "payment"."refund" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refund_account_idx" ON "payment"."refund" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "refund_status_idx" ON "payment"."refund" USING btree ("status","initiated_at");