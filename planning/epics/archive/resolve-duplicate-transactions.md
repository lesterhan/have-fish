# Epic: Resolve Duplicate Transactions

## Problem

When the same real-world financial event is visible from two different account statements,
importing both creates duplicate or overlapping transactions. The system should detect likely
duplicates during import preview and give the user the opportunity to skip the redundant row.

## Scenarios

### Scenario A — Cross-account transfer (complex)

**Example:** Transfer 200 CAD from `assets:td:chequing` to `assets:wise:cad`.

1. TD statement is imported first. The outflow is mapped as a regular transaction:
   - `assets:td:chequing` −200.00 CAD → `assets:wise:cad` +200.00 CAD

2. Wise statement is imported later. The inflow appears as a same-currency transfer with a fee:
   - `assets:wise:cad` +199.38 CAD
   - `expenses:fees:wise` +0.62 CAD
   - `assets:td:chequing` −200.00 CAD

Both describe the same event. The Wise version is more accurate (it captures the fee).
The TD version is a simpler stand-in that should be removed or skipped.

**Detection challenge:** amounts don't match on the surface (TD: −200.00, Wise net: +199.38).
Matching requires comparing the *gross* source amount (target + fee = 199.38 + 0.62 = 200.00)
against the existing transaction's amount, within a date proximity window.

**Proposed resolution:** flag the Wise import row as a likely duplicate in preview; give the
user a "skip" toggle per row. If they skip it, they should also manually soft-delete the earlier
TD transaction (or we surface a prompt to do so).

### Scenario B — Liability payment (simpler)

**Example:** Pay credit card — `assets:td:chequing` → `liabilities:td:visa` for 500.00 CAD.

1. TD chequing statement is imported: `assets:td:chequing` −500.00 → `liabilities:td:visa` +500.00
2. TD Visa statement is imported: a credit of +500.00 to `liabilities:td:visa` is parsed as a new row.

Both describe the same event. Amounts match exactly.

**Detection:** easier — same account, same amount (exact), close date.

**Proposed resolution:** same flag-and-skip approach in preview.

## Design notes

### Where to resolve

Import preview is the right surface — before anything is committed. Each flagged row gets a
"skip" toggle. The user imports only the rows they want.

### No auto-merging

Auto-merging two transactions is risky and complex. The user decides what to keep. The preferred
outcome is usually:
- Keep the richer version (e.g. the one with fee detail)
- Soft-delete the simpler stand-in

### Open questions

- **Date window:** how loose should proximity matching be? Same day? ±2 days? (Bank posting
  dates vs. value dates can differ.)
- **Amount matching for Scenario A:** match on gross (sum of all outflows in that currency) vs.
  some tolerance on net? What about cases where the fee is zero?
- **UI:** how prominent should the duplicate warning be? A muted badge on the row? A collapsible
  "possible duplicate" detail showing the matching existing transaction?
- **Post-import cleanup:** should the system prompt the user to delete the superseded transaction
  after a successful import that included a duplicate-skip?

## Out of scope (for now)

- Auto-merging / reconciliation of postings across transactions
- Duplicate detection outside of the import flow (e.g. for manually entered transactions)
