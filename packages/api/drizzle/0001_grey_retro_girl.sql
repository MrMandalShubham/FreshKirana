CREATE TABLE "identity"."account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."account_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"role" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."account_role" ADD CONSTRAINT "account_role_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "identity"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_phone_key" ON "identity"."account" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "account_role_account_idx" ON "identity"."account_role" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_role_scope_idx" ON "identity"."account_role" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_role_unique" ON "identity"."account_role" USING btree ("account_id","role",coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid));