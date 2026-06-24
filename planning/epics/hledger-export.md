# Epic: hledger journal export — the portability escape hatch

> **Status: SKELETON.** Stories below are placeholders pending hledger research
> (see "Open research" — Lester to do a pass on hledger's journal format and type
> directives before this is filled in and sequenced). Do not start implementation
> from this draft. What is firm: the **prereqs** in the next section, which other
> epics can begin satisfying now.

Goal: deliver Vision principle #2 — **portable data**. The system must export all
data to an [hledger](https://hledger.org/)-compatible `.journal` file. This is the
escape hatch: if the server is lost or the user moves tools, nothing is trapped.

A correct export means a third party (hledger itself) can read the file and report
the same balances, account types, and multi-currency conversions the app shows.
That bar — *hledger agrees with us* — is the acceptance test for the whole epic.

## Prerequisites (start these before the epic is fully scoped)

These are firm regardless of how the export stories shake out, and other epics can
begin landing them:

1. **Stored account `type` column.** Add nullable `accounts.type` holding the
   hledger type (Asset / Cash / Liability / Equity / Revenue / Expense / Conversion).
   Inference fills it on account create from the configured root paths; the stored
   value wins when present. This is the [[single-transaction-view]] epic's "C"
   decision (2026-06-24): ship a shared `resolveAccountType(account, settings)`
   resolver now (used by the posting-role classifier), then layer the stored column
   on top as an explicit override — no consumer rework, same additive pattern as
   `postings.role`.

2. **Manual type assignment in the UI.** Let the user override an account's type.
   This is what unlocks **atypically-named roots** that path-prefix inference cannot
   classify — e.g. `储蓄:中国银行` (savings: Bank of China → Asset/Cash) or
   `花钱:房租` (spending: rent → Expense). Without a manual override these export
   with the wrong `type:` directive (or none) and hledger mis-reports them. hledger's
   own guidance is that explicit `account ... type:X` declaration beats name
   inference — this mirrors it.

3. **`defaultIncomeRootPath` setting + income as a first-class type.** Today there is
   no income root and `accounts.ts` buckets everything non-asset/non-liability as
   `equity`, so `income:salary` is typed `equity`. Revenue must be its own type for
   both the role classifier and a correct journal export. (Landing in
   [[single-transaction-view]] story 1 as part of the resolver.)

## Open research (Lester)

Confirm against current hledger before scoping stories:

- **Journal syntax** — exact format for transactions, postings, comments, dates,
  multi-currency amounts, and the `account TYPE  type:X` declaration directive. Which
  of the 7 type codes (A/C/L/E/R/X/V) we emit and how subaccount inheritance works.
- **Commodity / currency directives** — how to declare currencies and display
  precision; whether we emit `commodity` directives. Amount format for non-CAD.
- **Cost / conversion notation** — how cross-currency spends (the Wise shape:
  transfer + `equity:conversion` + fee + spend) should be written so hledger reports
  the right cost basis. `@`/`@@` cost vs. explicit conversion postings vs. the
  `--infer-equity` / `equity:conversion` convention. This is the trickiest part and
  must round-trip cleanly.
- **Balance assertions** — whether to emit `= ASSERT` balance assertions from our
  reconciliation snapshots so an importer can verify integrity.
- **Round-trip** — is import-back in scope, or export-only for v1? Export-only is the
  likely v1 (the escape hatch is one-directional: get out, not sync).
- **Verification harness** — can CI run real `hledger` against an exported fixture and
  diff `hledger balance` / `hledger print` output against our own numbers? That would
  be the strongest possible test of "hledger agrees with us."

## Stories (DRAFT — do not implement)

1. **Account type column + resolver** (may be absorbed by the prereqs above /
   [[single-transaction-view]]). Stored `accounts.type`, inference backfill, read API
   surfaces type.
2. **Manual type assignment UI.** Override an account's type; covers atypical roots.
3. **Journal serializer.** Pure backend fn: data model → `.journal` string. Account
   declarations with `type:`, commodity directives, transactions with balanced
   multi-currency postings. Exhaustively unit-tested against canonical shapes.
4. **Cross-currency cost notation.** Get the Wise conversion shape to round-trip so
   hledger reports correct cost basis. (Depends on research above.)
5. **Export endpoint + download.** `GET /api/export/journal` streams the file;
   frontend "Export to hledger" action. Optional date range / account filters.
6. **hledger verification in CI.** Run real `hledger` against an export fixture, diff
   its reports against ours. The acceptance gate.

## Sequencing

Prereqs (type column + manual assignment + income type) can land incrementally via
[[single-transaction-view]] and a small follow-up. The serializer and verification
stories wait on Lester's hledger research. Export-only for v1; round-trip import is a
separate future consideration.
