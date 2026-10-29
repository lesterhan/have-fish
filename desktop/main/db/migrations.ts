// Generated from drizzle/ by `bun run db:bundle`. Don't edit it: change schema.ts, then run
// `bun run db:generate --name <change>` and `bun run db:bundle`.
import type { Migration } from './migrate'

export const MIGRATIONS: readonly Migration[] = [
  {
    "tag": "0000_meta",
    "statements": [
      "CREATE TABLE `meta` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`ledgerId` text NOT NULL,\n\t`deviceId` text NOT NULL,\n\t`installId` text NOT NULL,\n\t`clockWallMs` integer NOT NULL,\n\t`clockCounter` integer NOT NULL,\n\t`createdAt` integer NOT NULL,\n\tCONSTRAINT \"meta_one_row\" CHECK(\"meta\".\"id\" = 1),\n\tCONSTRAINT \"meta_ledger_id\" CHECK(length(\"meta\".\"ledgerId\") = 32 AND \"meta\".\"ledgerId\" NOT GLOB '*[^0-9a-f]*'),\n\tCONSTRAINT \"meta_device_id\" CHECK(length(\"meta\".\"deviceId\") = 16 AND \"meta\".\"deviceId\" NOT GLOB '*[^0-9a-f]*')\n);"
    ]
  },
  {
    "tag": "0001_ledger",
    "statements": [
      "CREATE TABLE `accounts` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`path` text NOT NULL,\n\t`pathKey` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`deletedAt` integer,\n\t`version` text NOT NULL\n);",
      "CREATE INDEX `accounts_path_key` ON `accounts` (`pathKey`);",
      "CREATE TABLE `postings` (\n\t`transactionId` text NOT NULL,\n\t`position` integer NOT NULL,\n\t`accountId` text NOT NULL,\n\t`amountCents` integer NOT NULL,\n\t`currency` text NOT NULL,\n\tPRIMARY KEY(`transactionId`, `position`),\n\tFOREIGN KEY (`transactionId`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,\n\tCONSTRAINT \"postings_amount_cents_integer\" CHECK(typeof(\"postings\".\"amountCents\") = 'integer')\n);",
      "CREATE INDEX `postings_account_id` ON `postings` (`accountId`);",
      "CREATE TABLE `transactions` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`date` text NOT NULL,\n\t`description` text NOT NULL,\n\t`deletedAt` integer,\n\t`version` text NOT NULL\n);",
      "CREATE INDEX `transactions_date` ON `transactions` (`date`);"
    ]
  }
]
