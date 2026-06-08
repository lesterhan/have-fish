ALTER TABLE "expense_group_members" ADD COLUMN "default_expense_account_id" uuid;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_group_members" ADD CONSTRAINT "expense_group_members_default_expense_account_id_accounts_id_fk" FOREIGN KEY ("default_expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
