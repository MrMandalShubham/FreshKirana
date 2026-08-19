CREATE TABLE "payment"."payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"provider_payment_id" text,
	"amount_paise" integer NOT NULL,
	"method" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment"."payment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_payment_id" text,
	"provider_order_id" text,
	"payment_id" uuid,
	"status" text NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" text,
	"source" text DEFAULT 'WEBHOOK' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_idempotency_key" ON "payment"."payment" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_order_key" ON "payment"."payment" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "payment_order_idx" ON "payment"."payment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_pending_idx" ON "payment"."payment" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_event_provider_key" ON "payment"."payment_event" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_event_payment_idx" ON "payment"."payment_event" USING btree ("payment_id");