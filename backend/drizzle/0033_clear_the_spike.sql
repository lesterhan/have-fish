CREATE INDEX IF NOT EXISTS "expense_group_invites_group_id_idx" ON "expense_group_invites" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_group_invites_invitee_email_idx" ON "expense_group_invites" USING btree ("invitee_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_group_members_user_id_idx" ON "expense_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_categories_group_id_idx" ON "group_categories" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_expenses_group_id_idx" ON "group_expenses" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_expenses_category_id_idx" ON "group_expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_settlements_group_id_idx" ON "group_settlements" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "postings_transaction_id_idx" ON "postings" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "postings_account_id_idx" ON "postings" USING btree ("account_id");