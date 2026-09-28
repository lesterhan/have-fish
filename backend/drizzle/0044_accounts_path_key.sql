-- #480: account paths ignore case. path_key is the path in the form paths are compared in,
-- pathKey() in src/accounts/paths.ts, which the app computes in TypeScript on every write.
--
-- Generated as one ADD COLUMN ... NOT NULL, which fails on a table with rows. Split by hand:
-- add it nullable, backfill, then tighten. The backfill is lower(path), the one step here that
-- is Postgres's lowercasing rather than the app's: the two agree on every path whose capitals
-- are ASCII, and scripts/check-account-paths.ts reports (and with --fix rewrites) any row where
-- they do not. The unique index fails the migration if a user already has two active paths
-- equal ignoring case; the PR that adds this file gives the query to run first.
-- accounts-path-key-migration.test.ts runs this file.
ALTER TABLE "accounts" ADD COLUMN "path_key" text;--> statement-breakpoint
UPDATE "accounts" SET "path_key" = lower("path");--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "path_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_path_key_idx" ON "accounts" USING btree ("user_id","path_key") WHERE "accounts"."deleted_at" is null;
