ALTER TABLE "csv_parsers" ADD COLUMN "is_multi_currency" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "csv_parsers" ADD COLUMN "default_fee_account_id" uuid;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "default_assets_root_path" text DEFAULT 'assets' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "csv_parsers" ADD CONSTRAINT "csv_parsers_default_fee_account_id_accounts_id_fk" FOREIGN KEY ("default_fee_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
