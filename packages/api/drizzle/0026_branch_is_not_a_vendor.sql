-- P5.2a: the shops are ours, so they are branches, not vendors.
--
-- RENAME throughout rather than drop-and-recreate: these tables hold data,
-- and a rename keeps every row, index and constraint in place.
--
-- `offer.vendor_offer` keeps its name on purpose. P5.3 splits that table
-- into a central price list and per-branch stock, so renaming it here would
-- be a migration spent on something about to be replaced. Its column does
-- rename, because it now points at a branch.
ALTER SCHEMA "vendor" RENAME TO "branch";
--> statement-breakpoint
ALTER TABLE "branch"."vendor" RENAME TO "branch";
--> statement-breakpoint
ALTER INDEX "branch"."vendor_slug_key" RENAME TO "branch_slug_key";
--> statement-breakpoint
ALTER INDEX "branch"."vendor_status_idx" RENAME TO "branch_status_idx";
--> statement-breakpoint
ALTER INDEX "branch"."vendor_pincode_idx" RENAME TO "branch_pincode_idx";
--> statement-breakpoint
ALTER TABLE "branch"."branch" RENAME CONSTRAINT "vendor_gstin_present_when_registered" TO "branch_gstin_present_when_registered";
--> statement-breakpoint
ALTER TABLE "branch"."branch" RENAME CONSTRAINT "vendor_gstin_shape" TO "branch_gstin_shape";
--> statement-breakpoint
ALTER TABLE "branch"."branch" RENAME CONSTRAINT "vendor_pincode_shape" TO "branch_pincode_shape";
--> statement-breakpoint
ALTER TABLE "branch"."branch" RENAME CONSTRAINT "vendor_fssai_required_when_active" TO "branch_fssai_required_when_active";
--> statement-breakpoint
ALTER TABLE "branch"."branch" RENAME CONSTRAINT "vendor_pkey" TO "branch_pkey";
--> statement-breakpoint
ALTER TABLE "cart"."cart" RENAME COLUMN "vendor_id" TO "branch_id";
--> statement-breakpoint
ALTER TABLE "catalog"."product_request" RENAME COLUMN "vendor_id" TO "branch_id";
--> statement-breakpoint
ALTER TABLE "notification"."message" RENAME COLUMN "vendor_id" TO "branch_id";
--> statement-breakpoint
ALTER TABLE "offer"."vendor_offer" RENAME COLUMN "vendor_id" TO "branch_id";
--> statement-breakpoint
ALTER TABLE "order"."order" RENAME COLUMN "vendor_id" TO "branch_id";
--> statement-breakpoint
ALTER TABLE "search"."product_index" RENAME COLUMN "best_vendor_id" TO "best_branch_id";
--> statement-breakpoint
ALTER TABLE "serviceability"."service_area" RENAME COLUMN "vendor_id" TO "branch_id";
--> statement-breakpoint
ALTER TABLE "serviceability"."slot_definition" RENAME COLUMN "vendor_id" TO "branch_id";
--> statement-breakpoint
ALTER TABLE "serviceability"."slot_instance" RENAME COLUMN "vendor_id" TO "branch_id";
--> statement-breakpoint
ALTER INDEX "cart"."cart_vendor_idx" RENAME TO "cart_branch_idx";
--> statement-breakpoint
ALTER INDEX "catalog"."product_request_vendor_idx" RENAME TO "product_request_branch_idx";
--> statement-breakpoint
ALTER INDEX "notification"."message_vendor_idx" RENAME TO "message_branch_idx";
--> statement-breakpoint
ALTER INDEX "offer"."vendor_offer_vendor_idx" RENAME TO "vendor_offer_branch_idx";
--> statement-breakpoint
ALTER INDEX "order"."order_vendor_idx" RENAME TO "order_branch_idx";
--> statement-breakpoint
ALTER INDEX "serviceability"."slot_definition_vendor_idx" RENAME TO "slot_definition_branch_idx";
