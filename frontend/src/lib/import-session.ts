import type { ImportPreviewResult } from '$lib/api'
import type { ClusterState } from '$lib/components/import/clustering'
import type { RowState } from '$lib/components/import/row-state'
import { importCopy } from './copy/import'

// An in-progress import, persisted so multi-step navigation, a refresh, a closed browser or
// a refused commit doesn't lose a half-categorized CSV.
//
// Kept on the server (`/api/import/sessions`, #535), as the plain JSON below: the backend
// stores it and hands it back without reading it. The commit that writes its rows deletes it
// in the same transaction, so a session that is gone is an import that landed. Before #535
// it lived in this browser's localStorage; `legacySessions` moves what is left there.

export type ImportStep = 'file' | 'accounts' | 'sort' | 'review' | 'confirm'

const STEP_IDS: ImportStep[] = ['file', 'accounts', 'sort', 'review', 'confirm']

export type ImportSession = {
  version: number
  fileHash: string // sha-256 of the CSV text
  fileName: string
  step: ImportStep
  defaultCurrency: string
  // The account a single-currency import posts to. Multi-currency imports use
  // currencyAccounts instead — a single-currency parser posts every row to one account
  // regardless of the row's currency, so keying that by currency would be a lie.
  fromAccountId: string
  // Currency code → account id, for multi-currency imports. The single source of truth
  // for "where does this currency's money live". Replaces re-deriving the account from a
  // `<root>:<currency>` naming convention, which made it impossible to point a currency
  // at an account that doesn't follow the pattern.
  currencyAccounts: Record<string, string>
  // null = follow the account path (the derived default); a boolean is an explicit override.
  importAsLiabilities: boolean | null
  preview: ImportPreviewResult
  rowStates: RowState[]
  // The Sort step's per-cluster decisions, keyed by merchant stem. Kept so walking back to
  // Sort shows the targets already chosen rather than an empty form.
  clusterStates: ClusterState[]
  // What this import has already written outside the ledger, for the Confirm manifest.
  // Recorded rather than counted at the end because rules and accounts are created as the
  // user goes, not deferred to commit.
  rulesCreated: string[]
  accountsCreated: string[]
  // Set when the import was launched from the Catch-Up Coach, carrying what the coach asked
  // for. Kept in the session rather than read from the URL each time so a refresh mid-import
  // doesn't lose the handoff and silently turn a coached import into an ordinary one.
  catchUp: CatchUpHandoff | null
  // What the user says the file covers, once they have confirmed or edited it. Null until
  // Confirm is reached, at which point it defaults per defaultCoverageRange().
  coverageRange: DateRange | null
  savedAt: string // ISO
}

export type DateRange = { from: string; to: string }

export type CatchUpHandoff = {
  accountId: string
  from: string
  to: string
}

// Where sessions lived before #535. Read once more, to move them to the server.
export const STORAGE_KEY = 'havefish:import-sessions'

// Bumped whenever the stored shape changes. A session written by an older version is
// dropped rather than migrated: sessions are short-lived working state, so migration code
// would outlive every session it could ever apply to. Each bump discards in-flight imports
// from the previous deploy — an acceptable trade for not carrying migrations.
//
// 2 — added currencyAccounts and the 'accounts' step.
// 3 — added clusterStates and the 'sort' step.
// 4 — added rulesCreated / accountsCreated and the 'confirm' step.
// 5 — added catchUp and coverageRange.
export const SESSION_VERSION = 5

// The server drops a session untouched this long; a legacy one older than it is not moved.
export const MAX_AGE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

// sha-256 of the CSV text. Identifies the file by content, so re-dropping the same export
// finds its session even if it was renamed, and an edited file correctly starts fresh.
export async function hashCsv(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isImportSession(value: unknown): value is ImportSession {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Partial<ImportSession>
  return (
    s.version === SESSION_VERSION &&
    typeof s.fileHash === 'string' &&
    typeof s.fileName === 'string' &&
    STEP_IDS.includes(s.step as ImportStep) &&
    typeof s.savedAt === 'string' &&
    !Number.isNaN(Date.parse(s.savedAt)) &&
    Array.isArray(s.rowStates) &&
    Array.isArray(s.clusterStates) &&
    Array.isArray(s.rulesCreated) &&
    Array.isArray(s.accountsCreated) &&
    typeof s.currencyAccounts === 'object' &&
    s.currencyAccounts !== null &&
    typeof s.preview === 'object' &&
    s.preview !== null
  )
}

export function isFresh(session: ImportSession, now: number): boolean {
  const age = now - Date.parse(session.savedAt)
  return age >= 0 && age <= MAX_AGE_DAYS * DAY_MS
}

// Drops malformed, wrong-version and expired entries. Returned newest-first.
export function pruneSessions(value: unknown, now: number): ImportSession[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s): s is ImportSession => isImportSession(s) && isFresh(s, now))
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
}

// A minimal slice of the Storage API, so these functions are testable without a DOM and
// can't throw on a server render where localStorage doesn't exist.
export type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): SessionStorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Access itself throws when storage is disabled (Safari private browsing).
    return null
  }
}

/**
 * The sessions this browser still holds from before #535, newest first. They stay in storage
 * until `forgetLegacySession` is told the server has each one, so a save that fails (the
 * server unreachable on the first visit after the upgrade) is tried again on the next visit
 * rather than losing the import. What could never be resumed (malformed, another version,
 * past `MAX_AGE_DAYS`) is dropped from storage here, which also bounds the retrying.
 */
export function legacySessions(
  now: number = Date.now(),
  storage: SessionStorageLike | null = defaultStorage(),
): ImportSession[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const sessions = pruneSessions(JSON.parse(raw), now)
    writeLegacy(sessions, storage)
    return sessions
  } catch {
    // Corrupt JSON, or storage that refuses: nothing to move, and nothing worth keeping.
    try {
      storage.removeItem(STORAGE_KEY)
    } catch {
      // Storage that refuses even this has nothing to give back either.
    }
    return []
  }
}

/** Drop one legacy session from storage, once the server holds it. */
export function forgetLegacySession(
  fileHash: string,
  now: number = Date.now(),
  storage: SessionStorageLike | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return
    writeLegacy(
      pruneSessions(JSON.parse(raw), now).filter((s) => s.fileHash !== fileHash),
      storage,
    )
  } catch {
    // Left in place, the server copy is overwritten with the same session on the next visit.
  }
}

function writeLegacy(sessions: ImportSession[], storage: SessionStorageLike): void {
  if (sessions.length === 0) storage.removeItem(STORAGE_KEY)
  else storage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

/**
 * The body `PUT /api/import/sessions/:fileHash` takes: the session, and beside it what the
 * list shows without loading it. `lastError` is the last refusal, already mapped onto the
 * preview's rows (`inPreviewRows`), or null.
 */
export function toSaved(session: ImportSession, lastError: unknown) {
  return {
    fileName: session.fileName,
    version: session.version,
    rowCount: session.rowStates.length,
    payload: session,
    lastError: lastError ?? null,
  }
}

// Human-readable age for the resume prompt ("saved 2 hours ago").
//
// A relative time is formatted data, like an amount or a date, so `Intl` words it and
// pluralises it; it used to splice an `s` onto the unit by hand. Only "just now" is copy —
// with `numeric: 'always'` so a day ago stays "1 day ago" rather than becoming "yesterday".
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })

export function describeAge(savedAt: string, now: number = Date.now()): string {
  const ms = now - Date.parse(savedAt)
  if (!Number.isFinite(ms) || ms < 60_000) return importCopy.resume.justNow
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return RELATIVE.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return RELATIVE.format(-hours, 'hour')
  return RELATIVE.format(-Math.floor(hours / 24), 'day')
}

// Reads a coach handoff off the import URL. Returns null unless every part is present and
// well-formed — a half-populated handoff would write coverage for a range nobody asked for.
export function parseCatchUpHandoff(params: URLSearchParams): CatchUpHandoff | null {
  const accountId = params.get('account')
  const from = params.get('from')
  const to = params.get('to')

  if (!accountId || !isIsoDate(from) || !isIsoDate(to)) return null
  if (from! > to!) return null

  return { accountId, from: from!, to: to! }
}

export function isIsoDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().substring(0, 10) === value
}

// What the Confirm step's "this file covers" control starts at.
//
// The coach's requested range wins over the file's own row dates, and the difference is the
// whole point: a statement covering Jul 1-31 whose first transaction is Jul 3 still covers
// Jul 1 and 2. Defaulting to the row dates would leave a two-day hole the coach then asks
// about forever, and the user would have no idea why.
export function defaultCoverageRange(
  handoff: CatchUpHandoff | null,
  fileRange: DateRange | null,
): DateRange | null {
  if (handoff) return { from: handoff.from, to: handoff.to }
  return fileRange
}
