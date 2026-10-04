import { describe, expect, it } from 'bun:test'
import { importCopy } from './copy/import'
import {
  defaultCoverageRange,
  describeAge,
  type ImportSession,
  isFresh,
  isImportSession,
  MAX_AGE_DAYS,
  parseCatchUpHandoff,
  pruneSessions,
  SESSION_VERSION,
  type SessionStorageLike,
  STORAGE_KEY,
  takeLegacySessions,
  toSaved,
} from './import-session'

const NOW = Date.parse('2026-06-15T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function fakeStorage(initial?: string): SessionStorageLike & { raw: () => string | null } {
  let value: string | null = initial ?? null
  return {
    getItem: (key) => (key === STORAGE_KEY ? value : null),
    removeItem: (key) => {
      if (key === STORAGE_KEY) value = null
    },
    raw: () => value,
  }
}

function makeSession(overrides: Partial<ImportSession> = {}): ImportSession {
  return {
    version: SESSION_VERSION,
    fileHash: 'abc123',
    fileName: 'wise-june.csv',
    step: 'review',
    defaultCurrency: 'CAD',
    fromAccountId: 'acct-1',
    currencyAccounts: {},
    clusterStates: [],
    rulesCreated: [],
    accountsCreated: [],
    importAsLiabilities: null,
    catchUp: null,
    coverageRange: null,
    preview: {
      parser: 'Wise',
      defaultAccountId: 'acct-1',
      isMultiCurrency: false,
      defaultFeeAccountId: null,
      transactions: [
        {
          isTransfer: false,
          date: '2026-06-01',
          amount: '-42.50',
          description: 'LOBLAWS #042',
        },
      ],
      errors: [],
    },
    rowStates: [
      {
        offsetAccountId: 'acct-2',
        conversionAccountId: '',
        feeAccountId: '',
        skipped: false,
        groupId: null,
        categoryId: null,
        kind: 'spend',
        expenseAccountId: '',
        source: 'rule',
      },
    ],
    savedAt: new Date(NOW).toISOString(),
    ...overrides,
  }
}

describe('the saved form', () => {
  // The server stores the payload as JSON and hands it back; what comes back must still be
  // a session the page can resume.
  const roundTrip = (session: ImportSession) =>
    JSON.parse(JSON.stringify(toSaved(session, null))).payload as unknown

  it('restores a saved session unchanged', () => {
    const session = makeSession()
    const restored = roundTrip(session)
    expect(isImportSession(restored)).toBe(true)
    expect(restored).toEqual(session)
  })

  it('preserves a hand-pointed currency mapping', () => {
    // RMB pointed at the CNY account — the case path derivation cannot express.
    const restored = roundTrip(makeSession({ currencyAccounts: { CAD: 'a-cad', RMB: 'a-cny' } }))
    expect((restored as ImportSession).currencyAccounts).toEqual({ CAD: 'a-cad', RMB: 'a-cny' })
  })

  it('carries what the list shows beside the session', () => {
    const lastError = { error: 'AMOUNT_INVALID', detail: { amount: 'x', index: 0 } }
    expect(toSaved(makeSession(), lastError)).toMatchObject({
      fileName: 'wise-june.csv',
      version: SESSION_VERSION,
      rowCount: 1,
      lastError,
    })
    expect(toSaved(makeSession(), undefined).lastError).toBeNull()
  })
})

describe('legacy sessions', () => {
  it('hands over what this browser held, newest first, and removes it', () => {
    const storage = fakeStorage(
      JSON.stringify([
        makeSession({ fileHash: 'old', savedAt: new Date(NOW - 5000).toISOString() }),
        makeSession({ fileHash: 'new' }),
      ]),
    )

    expect(takeLegacySessions(NOW, storage).map((s) => s.fileHash)).toEqual(['new', 'old'])
    expect(storage.raw()).toBeNull()
    expect(takeLegacySessions(NOW, storage)).toEqual([])
  })

  it('leaves out what could not be resumed anyway', () => {
    const storage = fakeStorage(
      JSON.stringify([
        makeSession({ fileHash: 'ok' }),
        { ...makeSession({ fileHash: 'stale' }), version: SESSION_VERSION - 1 },
        makeSession({
          fileHash: 'expired',
          savedAt: new Date(NOW - (MAX_AGE_DAYS + 1) * DAY).toISOString(),
        }),
      ]),
    )
    expect(takeLegacySessions(NOW, storage).map((s) => s.fileHash)).toEqual(['ok'])
  })

  it('returns nothing for corrupt JSON, an empty store, or no storage at all', () => {
    expect(takeLegacySessions(NOW, fakeStorage('{not json'))).toEqual([])
    expect(takeLegacySessions(NOW, fakeStorage())).toEqual([])
    expect(takeLegacySessions(NOW, null)).toEqual([])
  })
})

describe('staleness', () => {
  it('treats a session inside the window as fresh', () => {
    const session = makeSession({
      savedAt: new Date(NOW - 29 * DAY).toISOString(),
    })
    expect(isFresh(session, NOW)).toBe(true)
  })

  it('drops a session older than the retention window', () => {
    const session = makeSession({
      savedAt: new Date(NOW - (MAX_AGE_DAYS + 1) * DAY).toISOString(),
    })
    expect(isFresh(session, NOW)).toBe(false)
  })

  it('drops a session dated in the future', () => {
    // A clock change backwards would otherwise strand a session that never expires.
    const session = makeSession({ savedAt: new Date(NOW + DAY).toISOString() })
    expect(isFresh(session, NOW)).toBe(false)
  })
})

describe('pruning', () => {
  it('drops a session written by an older version', () => {
    const stale = { ...makeSession(), version: SESSION_VERSION - 1 }
    expect(pruneSessions([stale], NOW)).toHaveLength(0)
  })

  it('drops entries missing required fields', () => {
    expect(pruneSessions([{ version: SESSION_VERSION, fileHash: 'x' }], NOW)).toHaveLength(0)
  })

  it('drops an entry with an unrecognized step', () => {
    expect(pruneSessions([{ ...makeSession(), step: 'nonsense' }], NOW)).toHaveLength(0)
  })

  it('accepts every step in the flow', () => {
    for (const step of ['file', 'accounts', 'sort', 'review', 'confirm'] as const) {
      expect(pruneSessions([makeSession({ step })], NOW)).toHaveLength(1)
    }
  })

  it('drops an entry missing the created-artifact lists', () => {
    const { rulesCreated, ...withoutRules } = makeSession()
    expect(pruneSessions([withoutRules], NOW)).toHaveLength(0)
  })

  it('drops an entry with no cluster states', () => {
    const { clusterStates, ...withoutClusters } = makeSession()
    expect(pruneSessions([withoutClusters], NOW)).toHaveLength(0)
  })

  it('drops an entry with no currency map', () => {
    // A session written before the Accounts step existed; the version guard catches it
    // first, but the shape check must not let one through on its own.
    const { currencyAccounts, ...withoutMap } = makeSession()
    expect(pruneSessions([withoutMap], NOW)).toHaveLength(0)
  })

  it('returns newest first', () => {
    const many = [2, 0, 1].map((i) =>
      makeSession({
        fileHash: `hash-${i}`,
        savedAt: new Date(NOW - i * 1000).toISOString(),
      }),
    )
    expect(pruneSessions(many, NOW).map((s) => s.fileHash)).toEqual(['hash-0', 'hash-1', 'hash-2'])
  })

  it('ignores a stored value that is not an array', () => {
    expect(pruneSessions({ nope: true }, NOW)).toHaveLength(0)
  })
})

describe('describeAge', () => {
  it('describes recent, hourly and daily ages', () => {
    expect(describeAge(new Date(NOW - 30_000).toISOString(), NOW)).toBe(importCopy.resume.justNow)
    expect(describeAge(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 minutes ago')
    expect(describeAge(new Date(NOW - 60_000).toISOString(), NOW)).toBe('1 minute ago')
    expect(describeAge(new Date(NOW - 3 * 60 * 60_000).toISOString(), NOW)).toBe('3 hours ago')
    expect(describeAge(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe('2 days ago')
  })
})

describe('parseCatchUpHandoff', () => {
  const params = (q: string) => new URLSearchParams(q)

  it('reads a complete handoff', () => {
    expect(
      parseCatchUpHandoff(params('account=acct-1&from=2026-07-01&to=2026-07-31&return=catch-up')),
    ).toEqual({ accountId: 'acct-1', from: '2026-07-01', to: '2026-07-31' })
  })

  // A half-populated handoff would write coverage for a range nobody asked for.
  it('refuses an incomplete handoff', () => {
    expect(parseCatchUpHandoff(params('account=acct-1&from=2026-07-01'))).toBeNull()
    expect(parseCatchUpHandoff(params('from=2026-07-01&to=2026-07-31'))).toBeNull()
    expect(parseCatchUpHandoff(params(''))).toBeNull()
  })

  it('refuses malformed dates', () => {
    expect(parseCatchUpHandoff(params('account=a&from=01/07/2026&to=2026-07-31'))).toBeNull()
    expect(parseCatchUpHandoff(params('account=a&from=2026-02-30&to=2026-07-31'))).toBeNull()
  })

  it('refuses an inverted range', () => {
    expect(parseCatchUpHandoff(params('account=a&from=2026-07-31&to=2026-07-01'))).toBeNull()
  })

  it('accepts a single-day range', () => {
    expect(parseCatchUpHandoff(params('account=a&from=2026-07-05&to=2026-07-05'))).toMatchObject({
      from: '2026-07-05',
      to: '2026-07-05',
    })
  })
})

describe('defaultCoverageRange', () => {
  const handoff = { accountId: 'a', from: '2026-07-01', to: '2026-07-31' }
  const fileRange = { from: '2026-07-03', to: '2026-07-29' }

  // The whole point of the control: a statement covering Jul 1-31 whose first transaction is
  // Jul 3 still covers Jul 1 and 2. Defaulting to the row dates would leave a two-day hole the
  // coach then asks about forever.
  it("prefers what the coach asked for over the file's own dates", () => {
    expect(defaultCoverageRange(handoff, fileRange)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('falls back to the file dates for an ordinary import', () => {
    expect(defaultCoverageRange(null, fileRange)).toEqual(fileRange)
  })

  it('is null when there is nothing to go on', () => {
    expect(defaultCoverageRange(null, null)).toBeNull()
  })

  it('still uses the handoff when the file has no dated rows', () => {
    expect(defaultCoverageRange(handoff, null)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })
})
