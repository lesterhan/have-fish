CREATE TABLE `outbox` (
	`rowId` text PRIMARY KEY NOT NULL,
	`docType` text NOT NULL,
	`docId` text NOT NULL,
	`version` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_doc` ON `outbox` (`docType`,`docId`);