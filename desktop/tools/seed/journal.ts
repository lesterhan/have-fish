// `bun run try journal <file>`: an hledger journal written into a throwaway ledger through
// `applyLocal`, as the app writes. What it prints is counts, codes and line numbers, never what
// an entry or an account says.

import { randomUUID } from 'node:crypto'
import type { AccountKind } from '@have-fish/core/account-kind'
import type { AccountDoc, TransactionDoc } from '@have-fish/core/documents'
import type { FailureCode } from '@have-fish/core/outcome'
import { type Journal, readJournal } from '@have-fish/core/read-journal'
import { applyLocal } from '../../main/ledger/apply'
import { checkLedger, type LedgerCheck } from '../../main/ledger/check'
import { HOME_CURRENCY } from '../../shared/currency'
import { dayMs } from './book'
import { refuseIfOpen } from './commands'
import { open, prepare, removeLedger, type Where } from './sandbox'

/** A document, and the line of the journal it came from. */
export type Placed<D> = { line: number; doc: D }

export type LeftOut = { line: number; why: 'currency' | 'price' | 'account' | 'unread' | 'root' }

/** The code alone: a refusal's details can hold an amount or a path. */
export type Refused = { line: number; code: FailureCode }

/** `read` is always `written` plus those left out and refused. */
export type Tally = { read: number; written: number; leftOut: LeftOut[]; refused: Refused[] }

export type JournalReport = { entries: Tally; accounts: Tally; stray: number[] }

const HOUR_MS = 3_600_000

/** The kind an account takes from its root, and from its type under the roots where one counts. */
function kindFor(name: string, type: string | null): AccountKind | null {
  switch (name.split(':')[0]) {
    case 'assets':
      return type === 'C' ? 'cash' : 'bank'
    case 'liabilities':
      return 'card'
    case 'expenses':
      return 'category'
    case 'income':
      return 'income'
    case 'equity':
      return type === 'V' ? 'conversion' : 'opening'
    default:
      return null
  }
}

/** Noon on its date, a second after the one made before it that day, and never after now. */
function madeAt(date: string, n: number, nowMs: number): number {
  const at = dayMs(date) + 12 * HOUR_MS + n * 1000
  return Number.isNaN(at) || at < 0 ? nowMs : Math.min(at, nowMs)
}

/** The documents a journal makes, and what it leaves out, each with its line. */
export function documentsOf(
  journal: Journal,
  made: { deviceId: string; nowMs: number; newId: () => string },
): {
  accounts: Placed<AccountDoc>[]
  transactions: Placed<TransactionDoc>[]
  accountsLeftOut: LeftOut[]
  entriesLeftOut: LeftOut[]
} {
  const named = new Map<string, { line: number; type: string | null }>()
  for (const { line, name, type } of journal.accounts)
    if (!named.has(name)) named.set(name, { line, type })
  for (const { line, postings } of journal.entries)
    for (const { account } of postings)
      if (!named.has(account)) named.set(account, { line, type: null })

  const accounts: Placed<AccountDoc>[] = []
  const accountsLeftOut: LeftOut[] = []
  const ids = new Map<string, string>()
  for (const [path, { line, type }] of named) {
    const kind = kindFor(path, type)
    if (kind === null) {
      accountsLeftOut.push({ line, why: 'root' })
      continue
    }
    const id = made.newId()
    ids.set(path, id)
    accounts.push({
      line,
      doc: {
        type: 'account',
        id,
        path,
        kind,
        currency: null,
        deletedAt: null,
        origin: { source: 'manual', createdAt: made.nowMs, deviceId: made.deviceId },
      },
    })
  }

  const transactions: Placed<TransactionDoc>[] = []
  const entriesLeftOut: LeftOut[] = journal.skipped.flatMap(({ line, why }) =>
    why === 'stray' ? [] : [{ line, why }],
  )
  const madeOn = new Map<string, number>()
  for (const { line, date, description, postings: read } of journal.entries) {
    if (read.some((p) => p.currency !== HOME_CURRENCY)) {
      entriesLeftOut.push({ line, why: 'currency' })
      continue
    }
    const postings = read.flatMap(({ account, amount, currency }) => {
      const accountId = ids.get(account)
      return accountId === undefined ? [] : [{ accountId, amount, currency }]
    })
    if (postings.length < read.length) {
      entriesLeftOut.push({ line, why: 'account' })
      continue
    }
    const n = madeOn.get(date) ?? 0
    madeOn.set(date, n + 1)
    const createdAt = madeAt(date, n, made.nowMs)
    transactions.push({
      line,
      doc: {
        type: 'transaction',
        id: made.newId(),
        date,
        description,
        postings,
        deletedAt: null,
        origin: { source: 'manual', createdAt, deviceId: made.deviceId },
      },
    })
  }
  entriesLeftOut.sort((a, b) => a.line - b.line)
  return { accounts, transactions, accountsLeftOut, entriesLeftOut }
}

/**
 * Reads `text` into a new ledger in `where`, replacing the one there. A document the ledger
 * refuses is listed and taken out, and the rest of its slice applied again.
 */
export function seedJournal(
  where: Where,
  text: string,
  options: { nowMs?: number; batch?: number; progress?: (done: number) => void } = {},
): JournalReport {
  if (where.real) throw new Error('a journal is read into the sandbox only, never the real folders')
  refuseIfOpen(where)
  prepare(where)
  removeLedger(where)
  const journal = readJournal(text)
  const nowMs = options.nowMs ?? Date.now()
  const batch = options.batch ?? 5_000
  const ledger = open(where, nowMs)
  try {
    const docs = documentsOf(journal, { deviceId: ledger.meta.deviceId, nowMs, newId: randomUUID })
    const tally = (placed: number, leftOut: LeftOut[]): Tally => ({
      read: placed + leftOut.length,
      written: 0,
      leftOut,
      refused: [],
    })
    const accounts = tally(docs.accounts.length, docs.accountsLeftOut)
    const entries = tally(docs.transactions.length, docs.entriesLeftOut)

    let done = 0
    const apply = (documents: Placed<AccountDoc | TransactionDoc>[], into: Tally) => {
      for (let i = 0; i < documents.length; i += batch) {
        const rest = documents.slice(i, i + batch)
        while (rest.length > 0) {
          const applied = applyLocal(
            ledger,
            rest.map((p) => p.doc),
            nowMs,
          )
          if (applied.ok) break
          const { at, code } = applied.failure
          const refused = rest[at]
          if (refused === undefined)
            throw new Error(`applyLocal refused item ${at} of ${rest.length}`)
          into.refused.push({ line: refused.line, code })
          rest.splice(at, 1)
        }
        into.written += rest.length
        done += rest.length
        options.progress?.(done)
      }
    }
    apply(docs.accounts, accounts)
    apply(docs.transactions, entries)
    const stray = journal.skipped.filter((s) => s.why === 'stray').map((s) => s.line)
    return { entries, accounts, stray }
  } finally {
    ledger.close()
  }
}

const ENTRY_WORDS: [LeftOut['why'], string][] = [
  ['currency', `in a currency other than ${HOME_CURRENCY}`],
  ['price', 'with a price'],
  ['account', 'posting to an account left out'],
  ['unread', 'with a line it could not read'],
]

/** What a run read, wrote, left out and was refused: counts, codes and line numbers only. */
export function journalLines({ entries, accounts, stray }: JournalReport): string[] {
  const lines = [
    `Read the journal: ${entries.read} entries and ${accounts.read} accounts.`,
    `  written: ${entries.written} entries and ${accounts.written} accounts`,
  ]
  const group = (words: string, numbers: number[]) => {
    if (numbers.length > 0) lines.push(`  ${words}: ${numbers.length} (${linesOf(numbers)})`)
  }
  const linesLeftOutAs = (leftOut: LeftOut[], why: LeftOut['why']) =>
    leftOut.filter((l) => l.why === why).map((l) => l.line)
  const refusedBy = (refused: Refused[], words: string) => {
    for (const code of [...new Set(refused.map((r) => r.code))].sort())
      group(
        `${words}, ${code}`,
        refused.filter((r) => r.code === code).map((r) => r.line),
      )
  }

  for (const [why, words] of ENTRY_WORDS)
    group(`left out, ${words}`, linesLeftOutAs(entries.leftOut, why))
  group(
    'account left out, not under assets, liabilities, expenses, income or equity',
    linesLeftOutAs(accounts.leftOut, 'root'),
  )
  refusedBy(entries.refused, 'refused by the ledger')
  refusedBy(accounts.refused, 'account refused by the ledger')
  group('not read, outside any entry', stray)
  return lines
}

/** The ledger check, on the ledger `where` holds. */
export function checkSandbox(where: Where): LedgerCheck {
  const ledger = open(where)
  try {
    return checkLedger(ledger.db)
  } finally {
    ledger.close()
  }
}

/** The check as counts and codes: never an id, an amount or what SQLite said. */
export function checkLines(check: LedgerCheck): string[] {
  const { faults, pending } = check
  const lines = [`The ledger check: ${faults.length === 0 ? 'sound' : 'not sound'}.`]
  for (const code of [...new Set(faults.map((f) => f.code))].sort())
    lines.push(`  ${code}: ${faults.filter((f) => f.code === code).length}`)
  if (pending > 0) lines.push(`  waiting for an account the ledger doesn't hold yet: ${pending}`)
  return lines
}

/** `line 30`, `lines 30, 36`, and past ten the first ten and how many more. */
function linesOf(numbers: number[]): string {
  const sorted = numbers.toSorted((a, b) => a - b)
  if (sorted.length === 1) return `line ${sorted[0]}`
  const more = sorted.length > 10 ? ` and ${sorted.length - 10} more` : ''
  return `lines ${sorted.slice(0, 10).join(', ')}${more}`
}
