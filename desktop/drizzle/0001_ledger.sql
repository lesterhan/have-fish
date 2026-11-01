CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`pathKey` text NOT NULL,
	`kind` text NOT NULL,
	`deletedAt` integer,
	`version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_path_key` ON `accounts` (`pathKey`);--> statement-breakpoint
CREATE TABLE `postings` (
	`transactionId` text NOT NULL,
	`position` integer NOT NULL,
	`accountId` text NOT NULL,
	`amountCents` integer NOT NULL,
	`currency` text NOT NULL,
	PRIMARY KEY(`transactionId`, `position`),
	FOREIGN KEY (`transactionId`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "postings_amount_cents_integer" CHECK(typeof("postings"."amountCents") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `postings_account_id` ON `postings` (`accountId`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`deletedAt` integer,
	`version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`date`);