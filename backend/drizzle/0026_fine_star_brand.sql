ALTER TABLE "group_settlements" DROP CONSTRAINT "group_settlements_payer_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "group_settlements" DROP CONSTRAINT "group_settlements_payer_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "group_settlements" DROP CONSTRAINT "group_settlements_receiver_transaction_id_transactions_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_payer_account_id_accounts_id_fk" FOREIGN KEY ("payer_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_payer_transaction_id_transactions_id_fk" FOREIGN KEY ("payer_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_receiver_transaction_id_transactions_id_fk" FOREIGN KEY ("receiver_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
