# Epic: Support Transfer Direction

## Background

Wise (and similar institutions) export CSV files where **all amounts are positive**, regardless of
whether money is flowing in or out of the account. The direction is encoded in a separate column
(`Direction: IN / OUT`).

This was discovered when importing Wise card transactions — the current parser takes the raw
positive amount and stores it as-is, causing:

- **OUT card transactions**: asset account gets *credited* (+) instead of *debited* (−)
- **IN bank transfers**: currently imported as plain regular rows — the fee column is silently dropped

## CSV Reference

### OUT — same-currency card payment (e.g. a coffee)

```
"CARD_TRANSACTION-3532525227",COMPLETED,OUT,"2026-03-08 06:41:22","2026-03-08 06:41:22",0.00,EUR,,,"Lei Han",2.60,EUR,Coca-Cola,2.60,EUR,1.0000000000000000,,,"Lei Han",Shopping,
```

Relevant fields:
- Direction: `OUT`
- Source fee amount: `0.00`
- Source amount: `2.60`, Source currency: `EUR`
- Target amount: `2.60`, Target currency: `EUR`
- Same currency → falls to regular row path in the parser
- Amount should be stored as **−2.60** (money left the asset account)

### IN — same-currency bank transfer with fee

```
TRANSFER-2049673704,COMPLETED,IN,"2026-03-31 02:06:19","2026-03-31 02:08:57",0.62,CAD,,,"Lei Han",199.69,CAD,"Lei Han",199.69,CAD,1.0,,,"Lei Han","Money added",
```

Relevant fields:
- Direction: `IN`
- Source fee amount: `0.62`, Source fee currency: `CAD`
- Source amount: `199.69`, Source currency: `CAD`
- Target amount: `199.69`, Target currency: `CAD`
- Same currency → falls to regular row path in the parser
- Amount should be stored as **+199.69** (money arrived)
- Fee of **0.62 CAD** must NOT be dropped — it requires a third posting
- The source of the funds is another account owned by the user (asset account, income account, or
  in future a contact/person). The offset must cover the gross amount: 199.69 + 0.62 = **200.31**

### Correct double-entry for the IN transfer

```
assets:wise:cad    +199.69  CAD   (net amount received into Wise)
expenses:fees:wise   +0.62  CAD   (Wise fee for receiving the transfer)
  assets:bank:cad  −200.31  CAD   (gross amount that left the source account)
```

## Notes on `importAsLiabilities` toggle

The existing "Import as liabilities" toggle negates all amounts globally. This does **not** solve
the problem — it would correctly fix OUT rows but break IN rows in the same CSV. Direction-aware
sign handling is required.

## Stories

### Story 1 — Add `signColumn` / `signNegativeValue` to column mapping

Add two optional fields to `ColumnMapping`:

- `signColumn` — the CSV column whose value encodes direction (e.g. `"direction"`)
- `signNegativeValue` — the value in that column that means "amount should be negative" (e.g. `"out"`, compared case-insensitively)

When both are set, the dynamic parser negates the amount for regular rows where the sign column
matches the negative value.

For the Wise parser: `signColumn = "direction"`, `signNegativeValue = "out"`.

Changes: `backend/src/import/types.ts`, `backend/src/import/dynamic-parser.ts`,
`frontend/src/lib/api.ts`, `AddAccountWizard.svelte`.

#### Wizard UI decision

The two direction fields are added to **`STEP.PARSER_COLUMNS`** (not a new step, not the multi-currency step):

- `signColumn`: `<select>` from detected CSV columns, "— not mapped —" default. Optional — no asterisk, does not affect `parserColumnsValid`.
- `signNegativeValue`: plain `<input type="text">`, conditionally rendered only when `signColumn` is set. The value to match case-insensitively (e.g. `"out"`).

A tooltip `?` on the label explains the purpose. Both fields are added to `resetStep2()`, the `handleFileUpload()` reset block, the `columnMapping` payload in `handleConfirm()`, and the confirm summary.

### Story 2 — Handle same-currency IN transfers with fees

When the column mapping has `feeAmount` configured and a same-currency row carries a non-zero fee,
treat it as a **same-currency transfer row** rather than a plain regular row. This produces **3
postings** instead of 2:

| Account | Amount | Notes |
|---|---|---|
| Target (assets:wise:X) | +targetAmount | net amount received |
| Fee (expenses:fees:wise) | +feeAmount | Wise's transfer fee |
| Source (user-selected) | −(targetAmount + feeAmount) | gross amount debited from source |

In the import preview:
- Show the row similarly to the existing cross-currency transfer row (fee account + source account
  pickers)
- Source account choices: asset account (e.g. another bank), income account, or — in a future
  contacts feature — a person

Changes: `backend/src/import/dynamic-parser.ts`, `backend/src/import/types.ts`,
`backend/src/routes/import.ts`, `frontend/src/routes/(authed)/import/+page.svelte`.
