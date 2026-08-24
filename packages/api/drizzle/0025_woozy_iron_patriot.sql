CREATE TABLE "ledger"."account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"scope_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"txn_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_paise" bigint DEFAULT 0 NOT NULL,
	"credit_paise" bigint DEFAULT 0 NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid,
	"description" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entry_not_negative" CHECK (debit_paise >= 0 and credit_paise >= 0),
	CONSTRAINT "ledger_entry_one_side" CHECK ((debit_paise = 0) <> (credit_paise = 0))
);
--> statement-breakpoint
ALTER TABLE "ledger"."entry" ADD CONSTRAINT "entry_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "ledger"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_account_unique" ON "ledger"."account" USING btree ("type","scope_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_txn" ON "ledger"."entry" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_account" ON "ledger"."entry" USING btree ("account_id","posted_at");--> statement-breakpoint
CREATE INDEX "ledger_entry_ref" ON "ledger"."entry" USING btree ("ref_type","ref_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- The balance invariant (spec §2.4.4, rule R5, readiness G5).
--
-- The service checks this before writing and contracts checks it before that,
-- but both are code that a future path can go around. This is the copy that
-- cannot be bypassed: it runs at COMMIT, so a transaction that leaves any
-- journal entry unbalanced is refused and nothing is stored.
--
-- DEFERRABLE INITIALLY DEFERRED is what makes it usable at all — postings are
-- inserted one row at a time, so an immediate check would fire on the first
-- row of every entry and fail on a perfectly good entry mid-insert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.assert_entry_balances() RETURNS trigger AS $$
DECLARE
  difference bigint;
BEGIN
  SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0)
    INTO difference
    FROM ledger.entry
   WHERE txn_id = NEW.txn_id;

  IF difference <> 0 THEN
    RAISE EXCEPTION
      'ledger transaction % does not balance: debits minus credits = %',
      NEW.txn_id, difference
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entry_balances
  AFTER INSERT ON ledger.entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION ledger.assert_entry_balances();
--> statement-breakpoint
-- A ledger you can edit is a ledger you cannot audit: "who changed this number"
-- is the question that matters when a vendor disputes a payout. Corrections are
-- a new entry that reverses the old one.
CREATE OR REPLACE FUNCTION ledger.entries_are_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are append-only; post a reversing entry instead'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entry_no_update
  BEFORE UPDATE OR DELETE ON ledger.entry
  FOR EACH ROW
  EXECUTE FUNCTION ledger.entries_are_immutable();
