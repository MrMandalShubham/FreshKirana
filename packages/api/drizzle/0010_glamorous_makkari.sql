-- PostGIS, required by everything below (spec §2.8.1).
--
-- P0.2 chose a PostGIS image for local development, but the move to Cloud SQL
-- in P0.5b left the extension behind — it was never actually created in any
-- database. This is the migration that makes it true everywhere, which is why
-- it has to come before the first table that uses a geography column.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "serviceability"."service_area" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"mode" text DEFAULT 'RADIUS' NOT NULL,
	-- Hand-corrected: drizzle-kit quotes a custom dataType as an identifier,
	-- which renders as "geography(Polygon,4326)" and fails as an unknown type.
	-- Re-generating this migration will reintroduce the quotes.
	"polygon" geography(Polygon,4326),
	"centre_latitude" double precision NOT NULL,
	"centre_longitude" double precision NOT NULL,
	"radius_meters" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_area_mode_is_backed" CHECK (("serviceability"."service_area"."mode" = 'POLYGON' and "serviceability"."service_area"."polygon" is not null)
          or ("serviceability"."service_area"."mode" = 'RADIUS' and "serviceability"."service_area"."radius_meters" is not null and "serviceability"."service_area"."radius_meters" > 0)),
	CONSTRAINT "service_area_centre_in_range" CHECK ("serviceability"."service_area"."centre_latitude" >= 6 and "serviceability"."service_area"."centre_latitude" <= 38
          and "serviceability"."service_area"."centre_longitude" >= 68 and "serviceability"."service_area"."centre_longitude" <= 98)
);
--> statement-breakpoint
CREATE TABLE "serviceability"."slot_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"picking_capacity_orders" integer NOT NULL,
	"delivery_capacity_orders" integer NOT NULL,
	"cutoff_minutes_before" integer DEFAULT 90 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_definition_day_of_week" CHECK ("serviceability"."slot_definition"."day_of_week" between 0 and 6),
	CONSTRAINT "slot_definition_window_is_ordered" CHECK ("serviceability"."slot_definition"."start_minute" >= 0 and "serviceability"."slot_definition"."end_minute" <= 1440 and "serviceability"."slot_definition"."start_minute" < "serviceability"."slot_definition"."end_minute"),
	CONSTRAINT "slot_definition_capacity_not_negative" CHECK ("serviceability"."slot_definition"."picking_capacity_orders" >= 0 and "serviceability"."slot_definition"."delivery_capacity_orders" >= 0),
	CONSTRAINT "slot_definition_cutoff_not_negative" CHECK ("serviceability"."slot_definition"."cutoff_minutes_before" >= 0)
);
--> statement-breakpoint
CREATE TABLE "serviceability"."slot_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"slot_definition_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"booked" integer DEFAULT 0 NOT NULL,
	"cutoff_minutes_before" integer NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_instance_not_oversold" CHECK ("serviceability"."slot_instance"."booked" between 0 and "serviceability"."slot_instance"."capacity"),
	CONSTRAINT "slot_instance_capacity_not_negative" CHECK ("serviceability"."slot_instance"."capacity" >= 0),
	CONSTRAINT "slot_instance_window_is_ordered" CHECK ("serviceability"."slot_instance"."starts_at" < "serviceability"."slot_instance"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "serviceability"."waitlist_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"pincode" text NOT NULL,
	"city" text,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_pincode_format" CHECK ("serviceability"."waitlist_entry"."pincode" ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "user"."address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"label" text DEFAULT 'HOME' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"landmark" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"pincode" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"delivery_note" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "address_latitude_in_range" CHECK ("user"."address"."latitude" >= 6 and "user"."address"."latitude" <= 38),
	CONSTRAINT "address_longitude_in_range" CHECK ("user"."address"."longitude" >= 68 and "user"."address"."longitude" <= 98),
	CONSTRAINT "address_pincode_format" CHECK ("user"."address"."pincode" ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
ALTER TABLE "serviceability"."slot_instance" ADD CONSTRAINT "slot_instance_slot_definition_id_slot_definition_id_fk" FOREIGN KEY ("slot_definition_id") REFERENCES "serviceability"."slot_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_area_vendor_key" ON "serviceability"."service_area" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slot_definition_window_key" ON "serviceability"."slot_definition" USING btree ("vendor_id","day_of_week","start_minute");--> statement-breakpoint
CREATE INDEX "slot_definition_vendor_idx" ON "serviceability"."slot_definition" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slot_instance_date_key" ON "serviceability"."slot_instance" USING btree ("slot_definition_id","service_date");--> statement-breakpoint
CREATE INDEX "slot_instance_vendor_date_idx" ON "serviceability"."slot_instance" USING btree ("vendor_id","service_date");--> statement-breakpoint
CREATE INDEX "waitlist_pincode_idx" ON "serviceability"."waitlist_entry" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "address_account_idx" ON "user"."address" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "address_one_default_key" ON "user"."address" USING btree ("account_id") WHERE "user"."address"."is_default" and "user"."address"."deleted_at" is null;--> statement-breakpoint

-- Spatial indexes. Drizzle models neither GIST nor expression indexes, so these
-- are hand-written, and IF NOT EXISTS because CI applies migrations twice.
--
-- Without them every serviceability check is a sequential scan over every
-- store's geometry. That is invisible at ten vendors and is the whole latency
-- budget at a thousand — and this query runs before a shopper is allowed to do
-- anything at all.
CREATE INDEX IF NOT EXISTS "service_area_polygon_gix"
  ON "serviceability"."service_area"
  USING gist ("polygon");--> statement-breakpoint

-- The radius-mode equivalent: ST_DWithin against the store's centre point.
-- An expression index because the point is derived from two columns rather
-- than stored.
CREATE INDEX IF NOT EXISTS "service_area_centre_gix"
  ON "serviceability"."service_area"
  USING gist ((ST_SetSRID(ST_MakePoint("centre_longitude", "centre_latitude"), 4326)::geography));