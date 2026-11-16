// Reads an hledger journal in the form the hosted app exports it: `account` directives, entries
// and their postings, each with its line. Pure: text in, data out. An amount stays the text it
// was, so the ledger's own checks, not this file, say what it may hold.

export type JournalPosting = { account: string; amount: string; currency: string }

export type JournalEntry = {
  line: number
  date: string
  description: string
  postings: JournalPosting[]
}

export type JournalAccount = { line: number; name: string; type: string | null }

export type JournalSkip = { line: number; why: 'price' | 'unread' | 'stray' }

export type Journal = {
  accounts: JournalAccount[]
  entries: JournalEntry[]
  skipped: JournalSkip[]
}

const HEADER = /^(\d{4}-\d{2}-\d{2})(?: (?:\(\) )?(.*))?$/
const POSTING = /^[ \t]+(\S.*?) {2,}(-?\d+(?:\.\d+)?) ([A-Z]{3})$/
const PRICED = /^[ \t]+\S.*? {2,}-?\d+(?:\.\d+)? [A-Z]{3} @@? \S/

/** Never throws: what it can't read is in `skipped`, an entry's at its date line. */
export function readJournal(source: string): Journal {
  const journal: Journal = { accounts: [], entries: [], skipped: [] }
  // The entry being read, and why it is left out, decided by its first line it can't read.
  let entry: JournalEntry | null = null
  let leftOut: 'price' | 'unread' | null = null

  const end = () => {
    if (entry === null) return
    if (leftOut === null) journal.entries.push(entry)
    else journal.skipped.push({ line: entry.line, why: leftOut })
    entry = null
    leftOut = null
  }

  for (const [i, text] of source.split(/\r?\n/).entries()) {
    const n = i + 1
    if (text.trim() === '') {
      end()
      continue
    }
    if (text.startsWith(' ') || text.startsWith('\t')) {
      if (entry === null) {
        journal.skipped.push({ line: n, why: 'stray' })
        continue
      }
      if (leftOut !== null) continue
      const posting = POSTING.exec(text)
      if (posting) {
        const [, account = '', amount = '', currency = ''] = posting
        entry.postings.push({ account, amount, currency })
      } else leftOut = PRICED.test(text) ? 'price' : 'unread'
      continue
    }
    end()
    if (text.startsWith(';') || text.startsWith('commodity ')) continue
    if (text.startsWith('account ')) {
      journal.accounts.push({ line: n, ...directive(text.slice('account '.length)) })
      continue
    }
    const header = HEADER.exec(text)
    if (header)
      entry = { line: n, date: header[1] ?? '', description: header[2] ?? '', postings: [] }
    else journal.skipped.push({ line: n, why: 'stray' })
  }
  end()
  return journal
}

/** An `account` directive's name, up to two spaces, and the letter of its `; type:X` comment. */
function directive(rest: string): { name: string; type: string | null } {
  const at = rest.indexOf('  ')
  if (at === -1) return { name: rest, type: null }
  const type = /^; type:([A-Z])$/.exec(rest.slice(at + 2).trim())
  return { name: rest.slice(0, at), type: type?.[1] ?? null }
}
