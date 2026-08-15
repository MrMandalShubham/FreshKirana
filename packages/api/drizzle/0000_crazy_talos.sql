CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE SCHEMA "admin";
--> statement-breakpoint
CREATE SCHEMA "analytics";
--> statement-breakpoint
CREATE SCHEMA "cart";
--> statement-breakpoint
CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE SCHEMA "checkout";
--> statement-breakpoint
CREATE SCHEMA "cod";
--> statement-breakpoint
CREATE SCHEMA "delivery";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "inventory";
--> statement-breakpoint
CREATE SCHEMA "ledger";
--> statement-breakpoint
CREATE SCHEMA "notification";
--> statement-breakpoint
CREATE SCHEMA "offer";
--> statement-breakpoint
CREATE SCHEMA "order";
--> statement-breakpoint
CREATE SCHEMA "payment";
--> statement-breakpoint
CREATE SCHEMA "pricing";
--> statement-breakpoint
CREATE SCHEMA "search";
--> statement-breakpoint
CREATE SCHEMA "serviceability";
--> statement-breakpoint
CREATE SCHEMA "settlement";
--> statement-breakpoint
CREATE SCHEMA "support";
--> statement-breakpoint
CREATE SCHEMA "tax";
--> statement-breakpoint
CREATE SCHEMA "user";
--> statement-breakpoint
CREATE SCHEMA "vendor";
--> statement-breakpoint
CREATE TABLE "platform"."outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "platform"."outbox" USING btree ("created_at") WHERE "platform"."outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "platform"."outbox" USING btree ("aggregate_type","aggregate_id");