ALTER TABLE "group_settlements" ADD COLUMN "settled_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "group_settlements" ADD COLUMN "settled_currency" text;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD COLUMN "fx_rate" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "group_settlements" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_settlements_batch_id_idx" ON "group_settlements" USING btree ("batch_id");