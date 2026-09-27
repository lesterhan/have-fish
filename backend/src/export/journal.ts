// The hledger journal export (#283, planning/epics/hledger-export.md): the ledger as a
// `.journal` file that hledger itself reads and balances. This is Vision #2, the escape
// hatch: if the server is lost or the user moves tools, this file is the ledger.
//
// Pure: data in, text out. `export-service.ts` loads the rows; `export/hledger.test.ts`
// hands the output to a real hledger binary and checks it reports the balances the app does.
//
// Postings are written as stored, `amount CURRENCY`, with no `@`/`@@` cost notation. A
// conversion is already two currencies each balanced through the conversion account, so
// hledger balances it natively, and `--infer-costs` can rebuild the cost from those legs
// because that account is declared `type:V`.
//
// hledger's format has no escaping, so text that means something to its parser is changed
// rather than quoted. `journalAccountName` and `journalDescription` say what and why; each
// change is the smallest one that keeps what hledger reads equal to what the app holds.

import * as money from '../money'
import { HLEDGER_TYPE_CODE, type StoredAccountType } from '../postings/account-type'

/** An account to declare, with its resolved type; null declares it untyped. */
export type JournalAccount = { path: string; type: StoredAccountType | null }

/** One leg: the stored `numeric(12,2)` amount and its currency. */
export type JournalPosting = { accountPath: string; amount: string; currency: string }

/** A transaction and its live postings, in the order they should be written. */
export type JournalTransaction = {
  date: string
  description: string | null
  postings: readonly JournalPosting[]
}

export type JournalData = {
  accounts: readonly JournalAccount[]
  transactions: readonly JournalTransaction[]
}

const HEADER = [
  '; Exported from have-fish. Every amount is as stored; conversions balance through the',
  '; conversion account rather than with @ prices. Read it with: hledger -f <file> balance',
]

/**
 * The journal: a header, a `commodity` directive per currency used, an `account` directive
 * per account, then the transactions by date. Deterministic: the same data is the same text.
 *
 * Every account is declared, typed when its type resolves and bare when it doesn't, so
 * `hledger check --strict` passes on the file and an account with no type is visibly one
 * rather than silently missing from the declarations.
 */
export function serializeJournal(data: JournalData): string {
  const blocks: string[] = [HEADER.join('\n')]

  const currencies = new Set<string>()
  for (const t of data.transactions) for (const p of t.postings) currencies.add(p.currency)
  if (currencies.size > 0) {
    // `1000.00` fixes two decimals and no digit grouping, which is how every amount here is
    // written; without it hledger infers the same from the amounts, but strict mode wants
    // each commodity declared.
    blocks.push(
      [...currencies]
        .sort()
        .map((c) => `commodity 1000.00 ${c}`)
        .join('\n'),
    )
  }

  const declared = new Map<string, JournalAccount>()
  for (const a of data.accounts) declared.set(journalAccountName(a.path), a)
  if (declared.size > 0) {
    blocks.push(
      [...declared]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, a]) =>
          a.type ? `account ${name}  ; type:${HLEDGER_TYPE_CODE[a.type]}` : `account ${name}`,
        )
        .join('\n'),
    )
  }

  // Stable, so a day's transactions keep the order the caller gave them.
  const byDate = [...data.transactions].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  )
  for (const t of byDate) {
    const lines = [transactionLine(t.date, t.description)]
    for (const p of t.postings) {
      const amount = money.format(money.cents(p.amount))
      lines.push(`    ${journalAccountName(p.accountPath)}  ${amount} ${p.currency}`)
    }
    blocks.push(lines.join('\n'))
  }

  return `${blocks.join('\n\n')}\n`
}

// Line breaks and other control characters, including the Unicode line and paragraph
// separators. A line break is the one real injection: it would end the line and let the
// rest of the text start a new one, which could be a directive (`include /etc/passwd`).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g

/**
 * An account path as hledger can read it back as the same account.
 *
 * - Control characters become spaces, and any run of whitespace becomes one space: hledger
 *   ends an account name at two spaces or a tab, and reads what follows as the amount.
 * - A leading `(` or `[` becomes its full-width twin `（` `［`: hledger reads a bracketed
 *   name as a virtual posting, which leaves the transaction unbalanced, and refuses an
 *   `account` directive that starts with either.
 *
 * Paths the app accepts rarely contain any of these; this is what makes a strange one safe
 * rather than what shapes a normal one. Two paths that differ only in these characters
 * would read as one account in hledger.
 */
export function journalAccountName(path: string): string {
  return path
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\(/, '（')
    .replace(/^\[/, '［')
}

/**
 * A description as hledger will read it back, whole.
 *
 * - Control characters become spaces (a line break is the injection; see `CONTROL`).
 * - `;` becomes the full-width `；`: hledger ends the description at a semicolon and reads
 *   the rest as a comment, where a `date:` or `tag:` in bank text would start meaning
 *   something.
 *
 * A leading `*`, `!` or `(` would be read as a status or a code; `transactionLine` guards
 * that with an empty code rather than by changing the text.
 */
export function journalDescription(description: string | null): string {
  return (description ?? '').replace(CONTROL, ' ').replace(/;/g, '；').trim()
}

// `DATE DESCRIPTION`. A description that starts with a status mark or a parenthesis goes
// after an empty code, `()`, so hledger takes those characters as text: it reads a status
// and then a code only at the start, and prints an empty code as nothing.
function transactionLine(date: string, description: string | null): string {
  const text = journalDescription(description)
  if (!text) return date
  return /^[*!(]/.test(text) ? `${date} () ${text}` : `${date} ${text}`
}
