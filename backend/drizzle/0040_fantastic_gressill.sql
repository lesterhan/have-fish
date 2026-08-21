CREATE TABLE IF NOT EXISTS "account_coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"through_date" date NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "account_coverage_range_ordered" CHECK ("account_coverage"."from_date" <= "account_coverage"."through_date"),
	CONSTRAINT "account_coverage_source_valid" CHECK ("account_coverage"."source" IN ('import', 'reconcile', 'manual', 'empty'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_coverage" ADD CONSTRAINT "account_coverage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_coverage" ADD CONSTRAINT "account_coverage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_coverage_user_account_from_idx" ON "account_coverage" USING btree ("user_id","account_id","from_date");