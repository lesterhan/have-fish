CREATE TABLE IF NOT EXISTS "postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "categories" CASCADE;--> statement-breakpoint
ALTER TABLE "accounts" RENAME COLUMN "name" TO "path";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_account_id_accounts_id_fk";
--> statement-breakpoint
-- transactions_category_id_categories_id_fk is already dropped by CASCADE above
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "postings" ADD CONSTRAINT "postings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "type";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "currency";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "account_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "category_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "amount";