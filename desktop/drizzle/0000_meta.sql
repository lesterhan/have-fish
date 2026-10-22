CREATE TABLE `meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`ledgerId` text NOT NULL,
	`deviceId` text NOT NULL,
	`installId` text NOT NULL,
	`clockWallMs` integer NOT NULL,
	`clockCounter` integer NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT "meta_one_row" CHECK("meta"."id" = 1),
	CONSTRAINT "meta_ledger_id" CHECK(length("meta"."ledgerId") = 32 AND "meta"."ledgerId" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "meta_device_id" CHECK(length("meta"."deviceId") = 16 AND "meta"."deviceId" NOT GLOB '*[^0-9a-f]*')
);
