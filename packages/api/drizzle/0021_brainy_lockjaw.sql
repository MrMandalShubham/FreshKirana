CREATE TABLE "order"."substitution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"preference" text NOT NULL,
	"status" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen_vendor_offer_id" uuid,
	"chosen_name" text,
	"original_line_total_paise" integer NOT NULL,
	"charged_line_total_paise" integer,
	"refund_paise" integer DEFAULT 0 NOT NULL,
	"consented_to_higher_price" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order"."substitution" ADD CONSTRAINT "substitution_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "order"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order"."substitution" ADD CONSTRAINT "substitution_order_line_id_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "order"."order_line"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "substitution_order_idx" ON "order"."substitution" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "substitution_open_line_key" ON "order"."substitution" USING btree ("order_line_id") WHERE status = 'PROPOSED';--> statement-breakpoint
CREATE INDEX "substitution_pending_idx" ON "order"."substitution" USING btree ("status","expires_at");