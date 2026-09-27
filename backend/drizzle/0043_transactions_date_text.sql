-- #277: transactions.date becomes a calendar day, YYYY-MM-DD text.
--
-- Generated as a plain SET DATA TYPE text, then given its USING clause by hand: without
-- one, Postgres casts a timestamp to '2026-09-12 00:00:00'. With it, every existing row
-- keeps the day it shows today, because the app has always read this column as the UTC
-- date of the timestamp (toISOString().slice(0, 10), to_char(date::date)), and to_char of a
-- timestamp without time zone is exactly that. One statement, so the column is never half
-- converted. transactions-date-migration.test.ts runs this file.
ALTER TABLE "transactions" ALTER COLUMN "date" SET DATA TYPE text USING to_char("date", 'YYYY-MM-DD');
