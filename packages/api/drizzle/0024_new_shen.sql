CREATE TABLE "offer"."recall" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_product_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"raised_by" uuid NOT NULL,
	"batches_affected" integer DEFAULT 0 NOT NULL,
	"orders_affected" integer DEFAULT 0 NOT NULL,
	"customers_notified" integer DEFAULT 0 NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recall_open_batch_key" ON "offer"."recall" USING btree ("master_product_id","batch_no") WHERE status <> 'CLOSED';--> statement-breakpoint
CREATE INDEX "recall_status_idx" ON "offer"."recall" USING btree ("status","raised_at");