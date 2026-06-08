ALTER TABLE "group_settlements" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD COLUMN "payer_account_id" uuid;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD COLUMN "payer_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD COLUMN "receiver_transaction_id" uuid;--> statement-breakpoint
UPDATE "group_settlements" SET "status" = 'completed' WHERE "payer_transaction_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_payer_account_id_accounts_id_fk" FOREIGN KEY ("payer_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_payer_transaction_id_transactions_id_fk" FOREIGN KEY ("payer_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_receiver_transaction_id_transactions_id_fk" FOREIGN KEY ("receiver_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
