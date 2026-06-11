ALTER TABLE "expense_group_members" ADD COLUMN "default_payment_account_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_group_members" ADD CONSTRAINT "expense_group_members_default_payment_account_id_accounts_id_fk" FOREIGN KEY ("default_payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
