-- Written by hand over drizzle-kit's output. SQLite only adds a NOT NULL column that has a
-- default, and an origin has none, so both tables are rebuilt. Rows from before origins get
-- placeholders; no ledger outside the tests has any.
CREATE TABLE `__new_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`pathKey` text NOT NULL,
	`kind` text NOT NULL,
	`deletedAt` integer,
	`version` text NOT NULL,
	`originSource` text NOT NULL,
	`originCreatedAt` integer NOT NULL,
	`originDeviceId` text NOT NULL,
	`originFile` text,
	`originLine` integer,
	`originText` text
);
--> statement-breakpoint
INSERT INTO `__new_accounts` (`id`, `path`, `pathKey`, `kind`, `deletedAt`, `version`, `originSource`, `originCreatedAt`, `originDeviceId`)
	SELECT `id`, `path`, `pathKey`, `kind`, `deletedAt`, `version`, 'manual', 0, '0000000000000000' FROM `accounts`;
--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
CREATE INDEX `accounts_path_key` ON `accounts` (`pathKey`);--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`deletedAt` integer,
	`version` text NOT NULL,
	`originSource` text NOT NULL,
	`originCreatedAt` integer NOT NULL,
	`originDeviceId` text NOT NULL,
	`originFile` text,
	`originLine` integer,
	`originText` text
);
--> statement-breakpoint
INSERT INTO `__new_transactions` (`id`, `date`, `description`, `deletedAt`, `version`, `originSource`, `originCreatedAt`, `originDeviceId`)
	SELECT `id`, `date`, `description`, `deletedAt`, `version`, 'manual', 0, '0000000000000000' FROM `transactions`;
--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`date`);
