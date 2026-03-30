# Epic: Transactions Edit UX

Goal: Retool the transactions page so each transaction takes up less space and each posting is editable inline.

## Layout

Each transaction renders as a block with two sub-formats:

**Simple (exactly 2 postings):**
```
[date]  [description]                              [Edit]
        from-account → to-account    50.25 CAD
```

**Complex (3+ postings, e.g. currency transfer):**
```
[date]  [description]                              [Edit]
        from-account → to-account    100.00 CAD → 57.25 GBP
        [remaining postings, one per line]
```

The "from" account is the posting with the negative amount; "to" is the posting with the positive amount. If the two currencies differ, both amounts are shown on the summary line. Any remaining postings (fees, rate adjustments) appear as individual lines below the summary.

## Inline editing scope

- **Description** and **posting account paths** are click-to-edit cells.
- Amounts and currencies are display-only in this epic.
- The Edit button is a placeholder — full transaction editing is a future epic.

## Stories

### 1. Transaction table layout

Replace the journal view with the new table layout. No editing yet — just the visual structure.

- [ ] Render each transaction as a block: date + description on the first line, postings below
- [ ] 2-posting format: `from → to    amount currency` on one line
- [ ] 3+-posting format: summary line (`from → to    amountA currA → amountB currB`) + remaining postings below
- [ ] Edit button (disabled / no-op for now) on each transaction row
- [ ] Styling: retro table feel — `--shadow-sunken` container, row hover states, Tahoma at `--text-sm`

### 2. Backend: PATCH endpoints

- [ ] `PATCH /api/transactions/:id` — update `description` and/or `date`; ignore unknown fields
- [ ] `PATCH /api/postings/:id` — update `accountId`; validate account exists and belongs to the user
- [ ] Tests for both endpoints: happy path, not found, wrong user

### 3. Inline edit: description and account paths

- [ ] Click on description or any account path to enter edit mode for that cell
- [ ] Render an inline text input in place of the cell text; existing value pre-filled
- [ ] Enter or blur → call the appropriate PATCH endpoint and update the display; on error show inline error
- [ ] Escape → cancel with no change
- [ ] Only one cell editable at a time; clicking a second cell commits the first
