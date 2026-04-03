# Epic: Manual Transaction Entry

Goal: Let users create and edit transactions directly in the UI — without going through CSV import — for cash transactions, payroll, one-off corrections, and anything else that doesn't come from a bank export.

## Background

Currently the only way to create a transaction is via CSV import. This blocks several real-world workflows:

- **Cash transactions** — no CSV, no bank account involved
- **Payroll** — gross salary, tax withholdings, net deposit as a single multi-posting transaction
- **Corrections** — fixing a misclassified import after the fact
- **Manual transfers** — recording a transaction that only appears in one account's history

A manual transaction is structurally identical to an imported one: a date, an optional description, and N postings (account + amount + currency). The minimum is 2 postings that balance to zero per currency.

---

## Stories

### 1. Backend — create/update/delete transaction endpoints

Backend / routes.

- `POST /api/transactions` already exists (used by starting-balances flow) — verify it supports arbitrary postings
- `PATCH /api/transactions/:id` — update date and description
- `DELETE /api/transactions/:id` — soft delete (set deletedAt)
- `POST /api/transactions/:id/postings` — replace all postings on a transaction (for editing)

### 2. Manual entry form — simple 2-posting transaction

Frontend / Transactions page (or dedicated entry page).

- Form: date, description, account (AccountPathInput), amount, currency, offset account (AccountPathInput)
- This covers the common case: expense, income, transfer
- On submit: POST to `/api/transactions`

### 3. Manual entry form — multi-posting transaction

Frontend.

- Extend the form to support N postings (add/remove rows)
- Each posting row: account, amount, currency
- Running balance indicator shows whether postings balance to zero per currency
- Save disabled until balanced

### 4. Edit and delete existing transactions

Frontend / Transactions page.

- Each transaction row gets Edit and Delete actions
- Edit opens the multi-posting form pre-filled
- Delete prompts for confirmation (soft delete)
