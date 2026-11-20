CREATE TABLE `rates` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`fromCurrency` text NOT NULL,
	`toCurrency` text NOT NULL,
	`rate` text NOT NULL,
	`published` text,
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
CREATE INDEX `rates_date` ON `rates` (`date`);