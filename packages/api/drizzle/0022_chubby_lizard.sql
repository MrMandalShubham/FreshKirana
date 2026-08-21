ALTER TABLE "order"."order_line" ADD COLUMN "actual_grams" integer;--> statement-breakpoint
ALTER TABLE "order"."order_line" ADD COLUMN "price_per_kg_paise" integer;--> statement-breakpoint
ALTER TABLE "order"."order_line" ADD COLUMN "weight_tolerance_pct" integer;--> statement-breakpoint
ALTER TABLE "order"."order_line" ADD COLUMN "weighed_at" timestamp with time zone;