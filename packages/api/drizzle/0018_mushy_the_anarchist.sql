ALTER TABLE "payment"."payment" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment"."payment" ADD COLUMN "recovery_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_recovery_token_key" ON "payment"."payment" USING btree ("recovery_token");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_attempt_key" ON "payment"."payment" USING btree ("order_id","attempt");