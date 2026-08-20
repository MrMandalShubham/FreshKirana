CREATE TABLE "cod"."cod_config" (
	"key" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"thresholds" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cod"."cod_confirmation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"otp_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cod"."cod_risk_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"account_id" uuid NOT NULL,
	"band" text NOT NULL,
	"score" integer NOT NULL,
	"reasons" jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"confirmation_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cod_confirmation_order_key" ON "cod"."cod_confirmation" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "cod_confirmation_status_idx" ON "cod"."cod_confirmation" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "cod_decision_order_idx" ON "cod"."cod_risk_decision" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "cod_decision_account_idx" ON "cod"."cod_risk_decision" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "cod_decision_band_idx" ON "cod"."cod_risk_decision" USING btree ("band","created_at");