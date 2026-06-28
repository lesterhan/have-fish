# Epic: hledger journal export — the portability escape hatch

> **Status: SCOPED (2026-06-28).** Stories below are firm and sequenced. Cross-currency
> notation is resolved (see "Key finding"), so the skeleton's cost-notation story is gone.
> Scope decisions locked with Lester: stored type column **in v1**, balance assertions
> **skipped v1**, round-trip import **out of scope v1** (export-only escape hatch).

Goal: deliver Vision principle #2 — **portable data**. The system must export all data to
an [hledger](https://hledger.org/)-compatible `.journal` file. If the server is lost or the
user moves tools, nothing is trapped.

A correct export means a third party (hledger itself) reads the file and reports the same
balances, account types, and multi-currency conversions the app shows. That bar —
*hledger agrees with us* — is the acceptance test for the whole epic (story 5).

## Current state (verified 2026-06-28)

- **Income is first-class.** `userSettings.defaultIncomeRootPath` exists; `resolveAccountType`
  returns `income` distinct from `equity`. Skeleton prereq 3 is **done**.
- **Shared resolver exists.** `backend/src/postings/account-type.ts` →
  `resolveAccountType(path, roots)` returns one of `asset | liability | equity | income |
  expense`, or `null` for paths under no known root (atypical names). Longest-root-wins.
- **No stored `accounts.type` column** and **no manual override UI** yet (stories 1–2).
- **Export tab UI already shipped but disabled.** `frontend/src/routes/(authed)/import/+page.svelte`
  has an Export tab with `from`/`to` date inputs and an "Export journal" button, all
  `disabled` with a "Coming soon" tooltip. Story 4 enables them — no new layout work.
- **Posting shape:** `postings` table = `amount numeric(12,2)` + `currency` per row. A
  transaction is a metadata envelope (date, description); all money lives in postings.

## Key finding — cross-currency is already solved by the data model

The skeleton called cross-currency cost notation "the trickiest part." It isn't, because our
data stores conversions as **explicit `equity:conversion` legs** that make each transaction
balance **per-commodity**:

```
2026-06-28 Lunch in Paris
    assets:wise:cad     -100.00 CAD
    equity:conversion    100.00 CAD
    equity:conversion   -150.00 EUR
    expenses:food        150.00 EUR
```

CAD nets to 0, EUR nets to 0. hledger balances this natively — **we emit postings verbatim
with `amount CURRENCY`, no `@`/`@@` cost notation required.** Because our conversion account
is literally named `equity:conversion` (hledger's own convention), `hledger print
--infer-costs` can reconstruct cost basis for free when the user wants it. The serializer is
a dumb verbatim emitter; no separate cost-notation story.

## Type mapping

Our 5 resolver types → hledger type codes:

| our type    | hledger code | hledger name |
|-------------|--------------|--------------|
| `asset`     | `A`          | Asset        |
| `liability` | `L`          | Liability    |
| `equity`    | `E`          | Equity       |
| `income`    | `R`          | Revenue      |
| `expense`   | `X`          | Expense      |

We do **not** emit hledger's `C` (Cash) or `V` (Conversion) subtypes in v1 — the resolver
doesn't distinguish them and hledger reports correctly without them. `equity:conversion`
exports as plain `E`; `--infer-costs` still works (it keys on the account name, not the type).

## Stories

### 1. `accounts.type` column + stored-wins-else-infer resolver

- Add nullable `accounts.type` (text, holds `asset|liability|equity|income|expense`).
- Wrap the existing path resolver: a `resolveAccountType` caller path that returns the
  **stored value when present, else the inferred value**. Same additive pattern as
  `postings.role` — no caller rework; existing inference callers keep working.
- Backfill is implicit: stored column stays null, inference continues to answer. No data
  migration needed beyond the column add.
- Read API (`GET /api/accounts`) surfaces the resolved type so the UI and serializer share
  one answer.
- Tests: stored value overrides inference; null falls through to inference; atypical root
  with stored value resolves, without stays null.

### 2. Manual type-override UI

- Let the user set/clear an account's `type`. This is the unlock for atypically-named roots
  (`储蓄:中国银行` → Asset, `花钱:房租` → Expense) that path inference returns null for and
  would otherwise export with no `type:` directive.
- Surface: account settings / single-account view — a type select defaulting to the inferred
  value, with an explicit "override" affordance so the user sees inferred vs. stored.
- `PATCH /api/accounts/:id` accepts `type` (one of the five, or null to clear). Tests for
  set, clear, and invalid value rejection.

### 3. Journal serializer

- Pure backend fn: data model → `.journal` string. No I/O. Lives in `backend/src/export/`.
- Emits, in order:
  - `account <path>  type:<CODE>` declarations for every account (resolved type; skip the
    declaration when type is null so hledger infers nothing wrong).
  - Optional `commodity` directives for display precision (confirm exact need in research).
  - Transactions sorted by date: `YYYY-MM-DD description` then indented postings
    `    <path>  <amount> <CCY>`, emitted **verbatim** (no cost notation).
- Confirm exact `type:` directive syntax against current hledger before finalizing
  (`account NAME  type:X` inline vs. `; type: X` comment subdirective).
- Skips soft-deleted accounts/transactions/postings (`deletedAt IS NULL`).
- Exhaustively unit-tested against canonical shapes: single-currency, multi-currency Wise
  conversion, fee leg, atypical-root account with stored type, account with null type,
  income vs equity, empty data set.

### 4. Export endpoint + wire the existing UI

- `GET /api/export/journal?from=&to=` streams the `.journal` file (text/plain attachment).
  Optional ISO date bounds filter transactions; empty = everything.
- Enable the already-built Export tab: remove `disabled`, wire the date inputs and button to
  the endpoint, trigger a file download.
- Tests: full export, date-bounded export, empty range, auth required, only own data.

### 5. hledger verification harness in CI — the acceptance gate

- Seed a fixture user with canonical data (single + multi-currency + atypical-root +
  conversion). Export the journal.
- Install a real `hledger` binary in CI; run `hledger -f export.journal balance` and
  `hledger print`, and assert hledger's reported balances per account/commodity match what
  our own balance API reports for the same fixture. Fail CI on any divergence.
- This is the literal "hledger agrees with us" acceptance test for the epic.

## Out of scope (v1)

- **Balance assertions** from reconciliation snapshots — story 5's harness already proves
  correctness; assertions are redundant integrity belt-and-suspenders. Revisit later.
- **Round-trip import** (parse `.journal` → transactions) — the escape hatch is
  one-directional. Separate future epic.
- **Cash / Conversion hledger subtypes** — see type-mapping note.

## Sequencing

1 → 2 → 3 → 4 → 5. Stories 1–2 are independently shippable (and useful on their own — the
type column improves role classification). Story 3 has no UI and is pure/heavily tested.
Story 5 gates the epic as done.

## Open research (confirm before story 3)

- Exact `account ... type:X` directive syntax in current hledger; whether subaccounts
  inherit type (they do — declare only roots/overrides, or declare all? lean: declare all
  with a resolved type for explicitness).
- Whether `commodity` directives are needed for display precision or hledger infers fine
  from the amounts.
- Confirm `--infer-costs` reconstructs cost from our `equity:conversion` legs as expected
  (sanity check, not a blocker — verbatim postings already balance).
