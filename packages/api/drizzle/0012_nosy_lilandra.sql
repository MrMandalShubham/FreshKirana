CREATE TABLE "order"."order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_account_id" uuid,
	"actor_role" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_history_moved" CHECK ("order"."order_status_history"."from_status" is distinct from "order"."order_status_history"."to_status")
);
--> statement-breakpoint
ALTER TABLE "order"."order_status_history" ADD CONSTRAINT "order_status_history_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "order"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order"."order_status_history" USING btree ("order_id","created_at");