CREATE TABLE "notification"."inbound_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"from_phone" text NOT NULL,
	"reply" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"in_reply_to_message_id" uuid,
	"order_id" uuid,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification"."message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"template" text NOT NULL,
	"to_phone" text NOT NULL,
	"account_id" uuid,
	"vendor_id" uuid,
	"order_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider_message_id" text,
	"failure_reason" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_message_provider_key" ON "notification"."inbound_message" USING btree ("channel","provider_message_id");--> statement-breakpoint
CREATE INDEX "inbound_message_order_idx" ON "notification"."inbound_message" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "message_order_idx" ON "notification"."message" USING btree ("order_id","template");--> statement-breakpoint
CREATE INDEX "message_vendor_idx" ON "notification"."message" USING btree ("vendor_id","created_at");--> statement-breakpoint
CREATE INDEX "message_provider_idx" ON "notification"."message" USING btree ("provider_message_id");