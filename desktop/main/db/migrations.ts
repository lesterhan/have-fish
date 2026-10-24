// Generated from drizzle/ by `bun run db:bundle`. Don't edit it: change schema.ts, then run
// `bun run db:generate --name <change>` and `bun run db:bundle`.
import type { Migration } from './migrate'

export const MIGRATIONS: readonly Migration[] = [
  {
    "tag": "0000_meta",
    "statements": [
      "CREATE TABLE `meta` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`ledgerId` text NOT NULL,\n\t`deviceId` text NOT NULL,\n\t`installId` text NOT NULL,\n\t`clockWallMs` integer NOT NULL,\n\t`clockCounter` integer NOT NULL,\n\t`createdAt` integer NOT NULL,\n\tCONSTRAINT \"meta_one_row\" CHECK(\"meta\".\"id\" = 1),\n\tCONSTRAINT \"meta_ledger_id\" CHECK(length(\"meta\".\"ledgerId\") = 32 AND \"meta\".\"ledgerId\" NOT GLOB '*[^0-9a-f]*'),\n\tCONSTRAINT \"meta_device_id\" CHECK(length(\"meta\".\"deviceId\") = 16 AND \"meta\".\"deviceId\" NOT GLOB '*[^0-9a-f]*')\n);"
    ]
  }
]
