-- BUG-005: non-payer Fish Pie member transactions were created with inverted signs
-- (expenses:cat -share / group:slug +share). Correct double-entry is
-- expenses:cat +share / group:slug -share, so the member's share counts toward
-- their spending and their clearing-account debt is cleared by the existing
-- settlement payer leg (+amount).
--
-- Flips every posting of an ACTIVE non-payer member transaction. Soft-deleted
-- transactions are excluded on purpose: after a payer edit, the old payer's
-- soft-deleted tx can satisfy user_id != paid_by_user_id and must not be flipped.
-- Payer txs (user_id = paid_by_user_id), import txs (linked via
-- group_expenses.transaction_id, no group_expense_id), and settlement txs
-- (no group_expense_id) are untouched.
UPDATE "postings" SET "amount" = -"amount"
WHERE "deleted_at" IS NULL
  AND "transaction_id" IN (
    SELECT t."id"
    FROM "transactions" t
    JOIN "group_expenses" ge ON ge."id" = t."group_expense_id"
    WHERE t."user_id" <> ge."paid_by_user_id"
      AND t."deleted_at" IS NULL
  );
