-- Make transactions.group_expense_id the single, total forward link to a group expense.
--
-- An import-linked split expense (paid by the importer) records its origin bank line via
-- group_expenses.transaction_id, and historically left that transaction's own
-- group_expense_id null — so the belongs-to relationship was stored backwards for exactly
-- those rows. Readers had to follow both directions to answer "which expense is this?".
--
-- Backfill the forward link from the existing back-pointer so every transaction in a group
-- expense (member txs and the origin import tx alike) answers via group_expense_id. The
-- back-pointer group_expenses.transaction_id is kept, but now means only "this is the origin
-- import line — preserve it, don't regenerate it on edit", not "this is how you find me".
UPDATE "transactions" t
SET "group_expense_id" = ge."id"
FROM "group_expenses" ge
WHERE ge."transaction_id" = t."id"
  AND t."group_expense_id" IS NULL;
