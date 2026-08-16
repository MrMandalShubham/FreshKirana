CREATE TABLE "analytics"."event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid,
	"anon_id" text NOT NULL,
	"session_id" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text,
	"city" text,
	"experiment_variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_dedupe_idx" ON "analytics"."event" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_name_time_idx" ON "analytics"."event" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "event_account_idx" ON "analytics"."event" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_session_idx" ON "analytics"."event" USING btree ("session_id");