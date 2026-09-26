# Sync unit

**Tracked as [#281](https://github.com/lesterhan/have-fish/issues/281)**, a decision,
closed when this file was accepted. The schema work it describes is #454. Parent: P1, #244.

**Status: accepted** (2026-09-26, #281), corrections included. The design is the architecture audit's § "Sync unit design" (F2),
brought up to date with the code as it stands after the domain-layer epic's stories 1–3
and #279. What changed from the audit, and why, is under
[Corrections to the audit](#corrections-to-the-audit).

## Why the unit is a document, not a row

Sync replicates whatever it treats as one thing, and resolves a conflict by keeping one
version of that thing (last write wins). If that thing is a row, it goes wrong on the
ledger:

- Editing a transaction replaces all of its postings with new rows and new ids
  (`replacePostings` in `ledger/write-service.ts`).
- Device A edits a transaction, which replaces every posting. Meanwhile device B edits one
  posting of the same transaction.
- Row-level merge keeps B's edited row *and* A's new set. The deleted rows left no trace,
  so nothing tells the merge to drop them. The result is a transaction that no longer
  balances, found months later while reconciling a bank statement.

So the unit is a **document**: a root row plus the rows it owns, replicated, versioned and
merged as one. The root carries the version (`updatedAt`). The children carry none and are
replaced wholesale whenever the root is.

## Documents

| Document | Root | Children | Merge |
|---|---|---|---|
| Transaction | `transactions` | `postings` | Last write wins on the root; children replaced |
| Account | `accounts` | — | Last write wins |
| Parser | `csvParsers` | — | Last write wins |
| Rule | `importRules` | — | Last write wins |
| Settings | `userSettings` | — | Last write wins per field; `preferences` merged shallowly |
| Coverage | `accountCoverage` | — | Union by id; a withdrawn row (`deletedAt` set) wins over a live one |

A deleted document is a **tombstone**: the root with `deletedAt` set and its version
moved on. Deletion then needs no special case in the merge. A deleted transaction's
postings are removed with it, and the tombstone carries none.

Fish Pie's tables (`group_*`, `expense_groups`, the settlements) are **not** local-app
documents. The local app never replicates them; it only sees their effects, the
transactions Fish Pie writes into a member's ledger. Those are ordinary Transaction
documents that Fish Pie owns. How the Fish Pie service versions its own tables is decided
when it is extracted (#380).

## What the unit protects

**Postings balance per currency.** This holds by construction, because postings only ever
change together with their transaction, and `validatePostings` runs on every write. A
device that receives a document runs the same check (it is pure), so a malformed
document is refused on arrival rather than merged.

**A posting's account exists.** This is the one reference between documents. An Account
document may arrive after a Transaction document that points at it. The receiver accepts
the transaction, keeps a set of references still pending, and resolves them when the
account arrives. A badge counts what's unresolved. A sender pushes Account documents
before Transaction documents in any batch, so the set is usually empty.

## Identity, versions, and what is not replicated

**Identity.** Every id is a client-minted UUIDv4, except imported transactions. Those take
a UUIDv5 of their import fingerprint (#282), so that two devices importing the same bank
row mint the same id and converge without a merge.

**Versions.** The version is a hybrid logical clock `(wallMs, counter, deviceId)`,
compared in that order. `updatedAt` on the root is the wall-clock part, and it's the only
part added now. The counter and device id come with personal sync (P4) and live in its
change log, not on the row.

**Not replicated:**
- `fxRates`: each device fetches or enters its own.
- Better Auth's tables: identity belongs to the relay account, not the ledger.
- The change log itself.

## Keeping `updatedAt` honest

A version is only useful if **every** change to a document moves it. That includes a
change to a child row: a re-pointed posting is a changed transaction. Two mechanisms cover
this, and a test holds each one:

1. **A change to a root** moves its version automatically. `updatedAt` is declared with
   Drizzle's `$onUpdate(() => new Date())`, so every `update(...)` of a root row sets it
   without the caller asking. That covers PATCH, soft deletes, the Fish Pie link stamp, and
   the settings and rules routes, which set it by hand today.
2. **A change to postings alone** goes through the ledger service, which moves the
   transaction's version in the same database transaction:
   - inserting, replacing and amending already go through `ledger/write-service.ts`, which
     starts moving the version in this change;
   - six sites still change postings directly, and move into the service:
     - four Fish Pie sites (an expense edit, the two expense-delete routes, a
       settlement delete) each soft-delete a set of transactions and their postings. The
       code is the same in all four, so it becomes one `retireTransactions`;
     - `heal-service` re-points a posting to another account;
     - the Fish Pie group merge re-points every posting on the old clearing accounts. Every
       transaction it touches gets a new version.

   The existing gate test (`ledger/writers.test.ts`) gains `update(postings)` and
   `delete(postings)`. After that, no module outside `ledger/` can change a posting, so no
   future writer can forget the version.

Neither mechanism is a database trigger. A trigger would work on Postgres, but P1 is
dialect-neutral groundwork, and SQLite's triggers are a second implementation of the same
rule.

## The schema work

This is one PR, filed as its own issue once this file is agreed:

- `updatedAt` (not null, default now, `$onUpdate`) on `accounts`, `transactions` and
  `csvParsers`.
- `$onUpdate` on the `updatedAt` that `importRules` and `userSettings` already have, and
  the hand-written `updatedAt: new Date()` in their routes removed.
- The six direct posting writers move into `ledger/` (`retireTransactions` and a re-point),
  and the gate test widens to cover them.
- Existing rows take the migration time as their `updatedAt`. Nothing has synced yet, so
  no version is being compared against, and the migration stays one generated file.

**Acceptance:** for each writer, a test that `updatedAt` moves when the document changes,
including a posting-only change. The gate test fails if a posting is changed outside
`ledger/`.

## Corrections to the audit

| The audit said | The code says | So |
|---|---|---|
| Add `updatedAt` to Fish Pie's `groupExpenses`, `groupSettlements` and `expenseGroups` | Fish Pie leaves for its own service (#380). The local app never replicates those tables; its ownership rules already say so | Left out; decided at extraction |
| Bump `transactions.updatedAt` at seven listed sites | One of them, `routes/postings.ts`, is gone (#432), and five now go through the ledger service. Six sites the list missed or that remain still write postings directly: heal, the group merge, and four Fish Pie deletes | `$onUpdate` for roots, the service for postings, the gate so none are missed again |
| Rules and settings need `updatedAt` | They have it, set by hand in each route | `$onUpdate`, so it can't be forgotten |
| Coverage is append-only | Withdrawing a claim sets `deletedAt` on the row | Union still works: a withdrawn row wins |
| Add `transactions.origin` (U2) in the same PR | U2 is provenance for the UI, and has screens to design | Separate. This PR changes versions only |
