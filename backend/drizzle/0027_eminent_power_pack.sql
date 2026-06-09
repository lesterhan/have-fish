ALTER TABLE "group_expenses" DROP CONSTRAINT "group_expenses_transaction_id_transactions_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
