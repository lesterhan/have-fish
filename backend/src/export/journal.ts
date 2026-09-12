// hledger journal serializer (hledger-export epic, story 3).
//
// Pure function: an in-memory snapshot of the user's data -> an hledger-compatible `.journal`
// string. No I/O, no DB. The export endpoint (story 4) loads active rows, maps them to the
// JournalData shape, and hands them here. Story 5's CI harness feeds the output to a real
// hledger binary and asserts hledger reports the same balances we do — that is the bar this
// serializer must clear.
//
// Why verbatim postings (no @/@@ cost notation): our cross-currency transactions already carry
// explicit `equity:conversion` legs that balance per-commodity (see the epic's "Key finding").
// We emit each posting's amount and currency exactly as stored; hledger balances natively, and
// `hledger print --infer-costs` can reconstruct cost basis from the conversion legs on demand.

import {
  resolveStoredOrInferredType,
  HLEDGER_TYPE_CODE,
  type AccountTypeRoots,
  type StoredAccountType,
} from '../postings/account-type'

// An account to potentially declare. `type` is the raw stored override column (may be null or
// even an invalid string — resolveStoredOrInferredType validates and falls back to inference).
export interface JournalAccount {
  path: string
  type: string | null
}

// One leg of a transaction. `amount` is the numeric(12,2) string straight from the DB
// (e.g. "-100.00") — emitted verbatim. `currency` is an ISO 4217 code.
export interface JournalPosting {
  accountPath: string
  amount: string
  currency: string
}

// A transaction envelope plus its postings. Callers pass only active (non-soft-deleted) rows.
export interface JournalTransaction {
  date: Date
  description: string | null
  postings: JournalPosting[]
}

export interface JournalData {
  accounts: JournalAccount[]
  transactions: JournalTransaction[]
}

// Dates are stored UTC; format the UTC calendar day so a timestamp never shifts across a day
// boundary by local timezone.
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// hledger reads a transaction's description as the rest of the line, where an unescaped `;`
// would start a comment. Collapse any newlines (which would break the single-line format) to
// spaces and trim. Semicolons are left as-is — rare in practice and harmless to balances.
function sanitizeDescription(description: string | null): string {
  return (description ?? '').replace(/[\r\n]+/g, ' ').trim()
}

// Serializes the snapshot to a `.journal` string. Output is deterministic: account directives
// sorted by path, transactions sorted by date (stable — same-date order is preserved from the
// input). Trailing newline; empty input yields an empty string.
//
// We declare an `account ... ; type:CODE` directive only for accounts whose type resolves
// (stored override, else path inference). Accounts that resolve to null (atypically-named roots
// with no override) get no directive — declaring a guessed type would be worse than letting
// hledger leave them unclassified; balances are unaffected either way.
export function serializeJournal(data: JournalData, roots: AccountTypeRoots): string {
  // Each section is a self-contained block of text; blocks are joined with a blank line so a
  // missing section never leaves a dangling separator.
  const blocks: string[] = []

  const declarations = data.accounts
    .map((a) => ({ path: a.path, type: resolveStoredOrInferredType(a, roots) }))
    .filter((a): a is { path: string; type: StoredAccountType } => a.type !== null)
    .sort((a, b) => a.path.localeCompare(b.path))

  if (declarations.length > 0) {
    blocks.push(
      declarations.map((d) => `account ${d.path}  ; type:${HLEDGER_TYPE_CODE[d.type]}`).join('\n'),
    )
  }

  const transactions = [...data.transactions].sort((a, b) => a.date.getTime() - b.date.getTime())

  for (const txn of transactions) {
    const date = formatDate(txn.date)
    const description = sanitizeDescription(txn.description)
    const header = description ? `${date} ${description}` : date
    const postings = txn.postings.map((p) => `    ${p.accountPath}  ${p.amount} ${p.currency}`)
    blocks.push([header, ...postings].join('\n'))
  }

  return blocks.length > 0 ? blocks.join('\n\n') + '\n' : ''
}
