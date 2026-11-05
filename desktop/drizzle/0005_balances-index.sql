DROP INDEX `postings_account_id`;--> statement-breakpoint
CREATE INDEX `postings_account_balance` ON `postings` (`accountId`,`currency`,`amountCents`);