# Epic: Currency Transfers

Goal: Detect currency transfer rows during CSV import and generate the correct 5-posting double-entry transaction with full pre-filling, making cross-currency bookkeeping frictionless.

## Background

A currency transfer (e.g. Wise CAD → GBP) produces 5 postings:

| Account              | Amount   | Currency |
|----------------------|----------|----------|
| assets:wise:cad      | −200.00  | CAD      |
| equity:conversion    | +199.04  | CAD      |
| expenses:fees:wise   | +0.96    | CAD      |
| equity:conversion    | −107.90  | GBP      |
| assets:wise:gbp      | +107.90  | GBP      |

Detection rule: a row is a transfer when `sourceCurrency ≠ targetCurrency`.

Account inference: `defaultAccountId` on the parser is the root path (e.g. `assets:wise`).
All child accounts are derived from it: `root + ":" + currency.toLowerCase()`.
- Regular row source account: `assets:wise:cad` (from sourceCurrency)
- Transfer source account: `assets:wise:cad`, transfer target account: `assets:wise:gbp`

For multi-currency parsers, per-row source account replaces the global `fromAccountId`
that non-multi-currency parsers use.

No schema changes to `transactions` or `postings` — the existing model already supports this.

---

## Stories

### 1. Extend parser schema for multi-currency accounts

Backend / DB.

- Add `isMultiCurrency boolean` to `csvParsers` schema
- Add `defaultFeeAccountId uuid` to `csvParsers` schema (institution-specific fee account)
- Extend `ColumnMapping` type with optional transfer fields:
  `sourceAmount`, `sourceCurrency`, `targetAmount`, `targetCurrency`, `feeAmount`, `feeCurrency`
- Generate and apply migration
- Expose `isMultiCurrency`, `defaultFeeAccountId` in the preview response

### 2. Extend `buildParser` for transfer row detection

Backend / import layer.

- Add `TransferParsedTransaction` type:
  `{ isTransfer: true, date, description?, sourceAmount, sourceCurrency, targetAmount, targetCurrency, feeAmount?, feeCurrency? }`
- Make `ParsedTransaction` a discriminated union:
  `{ isTransfer: false, ...existing fields } | TransferParsedTransaction`
- In `buildParser`: when transfer columns are mapped and `sourceCurrency ≠ targetCurrency`,
  emit a `TransferParsedTransaction` instead of a regular one

### 3. Parser config UI — multi-currency checkbox

Frontend / settings page.

- Add "Multi-currency account" checkbox to the parser create/edit form
- Checkbox has an info tooltip "Enables support for inline multi-currency transfers (e.g. Wise)"
- When checked, reveal additional column mapping fields:
  Source amount column, Source currency column, Target amount column,
  Target currency column, Fee amount column, Fee currency column
- Reveal "Default fee account" AccountPathInput (user can select existing or create new)
- The existing "Default account" field label/hint updates to clarify it is the root path
  (e.g. `assets:wise`, not a leaf like `assets:wise:cad`)
- Save all new fields through the existing parsers API

### 4. Import preview — child account inference + missing account banner

Frontend / import page.

For multi-currency parsers (`preview.isMultiCurrency === true`):
- Hide the global "From account" selector (source is per-row, not global)
- For every row (regular and transfer), infer the source account:
  `root + ":" + sourceCurrency.toLowerCase()`
- For transfer rows, also infer the target account:
  `root + ":" + targetCurrency.toLowerCase()`
- Collect all inferred account paths and check against the loaded accounts list
- For any path that doesn't exist, show a banner above the preview table:
  "The following accounts are needed: [assets:wise:cny] [assets:wise:eur] — Create all?"
  Each missing account has its own inline "Create" button; clicking it calls the accounts API
  and on success pre-fills the appropriate row inputs automatically
- Pre-fill `conversionAccountId` from `userSettings.defaultConversionAccountId`
- Pre-fill `feeAccountId` from `preview.defaultFeeAccountId`
- Transfer rows render differently in the preview table:
  show source amount → exchange rate arrow → target amount + fee line
  with "Target account" AccountPathInput instead of the regular "To account"

### 5. Import commit — 5-posting transfer transactions

Backend / import route.

- In `POST /api/import/commit`, detect `isTransfer: true` on incoming rows
- For transfer rows, require: `sourceAccountId`, `targetAccountId`, `conversionAccountId`, `feeAccountId`
- Generate 5 postings (see Background table above)
- Regular rows continue to produce 2 postings — no change to existing path
