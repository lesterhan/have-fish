import { describe, expect, test } from 'vitest'
import type { Bridge, Changed, CommandName, ListedTransaction, Wire } from '../../shared/commands'
import { indexIn, type LedgerState, ledgerStore, PAGE, rowAt, rowWithId } from './ledger'

/** What one load asks main for, besides the pages. */
const LISTS: CommandName[] = ['account.list', 'spend.assumedFrom', 'transaction.days']

type Call = { name: CommandName; input: unknown; answer(value: Wire<unknown>): void }

const idOf = (i: number) => `t${i}`
const row = (i: number) => ({ id: idOf(i), description: `Spend ${i}` }) as ListedTransaction
/** A row written since the list began, newer than every other. */
const newRow = (i: number) => ({ id: `n${i}`, description: `New ${i}` }) as ListedTransaction

/**
 * A bridge over a list of `size` rows whose replies wait until the test gives them, so a load can
 * be caught mid-way. `gone` rows have been removed; `write(n)` puts n new rows at the top.
 */
function fakeBridge(size = 3) {
  const waiting: Call[] = []
  const asked: Call[] = []
  const gone = new Set<string>()
  let added = 0
  let notify: (changed: Changed[]) => void = () => {}
  const bridge = {
    invoke(name: CommandName, input: unknown) {
      return new Promise((resolve) => {
        const call = { name, input, answer: resolve }
        asked.push(call)
        waiting.push(call)
      })
    },
    onChanged(listener: (changed: Changed[]) => void) {
      notify = listener
      return () => {
        notify = () => {}
      }
    },
  } as unknown as Bridge
  const answerTo = (name: CommandName, input: unknown): unknown => {
    if (name === 'transaction.page') {
      const { from, limit } = input as { from: number; limit: number }
      const total = size + added
      const rows = Array.from({ length: Math.max(Math.min(limit, total - from), 0) }, (_, i) =>
        from + i < added ? newRow(from + i) : row(from + i - added),
      )
      // Each page is a day of its own, netting its first row's number, negated.
      return {
        total,
        from,
        rows,
        nets: [{ date: `day ${from}`, net: [{ amount: `-${from}.00`, currency: 'CAD' }] }],
      }
    }
    if (name === 'transaction.days') return [{ date: 'every day', count: size }]
    if (name === 'path.list') return []
    if (name === 'transaction.position') {
      const { id } = input as { id: string }
      const at = Number(id.slice(1))
      return { at: gone.has(id) || at >= size ? null : at + added }
    }
    if (name === 'transaction.get') {
      const { ids } = input as { ids: string[] }
      return ids.filter((id) => !gone.has(id)).map((id) => row(Number(id.slice(1))))
    }
    return {
      'account.list': [{ id: 'a1' }],
      'spend.assumedFrom': { id: 'a1' },
    }[name as string]
  }
  return {
    bridge,
    gone,
    write: (n: number) => {
      added += n
    },
    notify: () => notify([]),
    /** How many times the store asked for `name`. */
    count: (name: CommandName) => asked.filter((c) => c.name === name).length,
    /** The pages asked for, by page number, in order. */
    pagesAsked: () =>
      asked
        .filter((c) => c.name === 'transaction.page')
        .map((c) => (c.input as { from: number }).from / PAGE),
    forget: () => asked.splice(0),
    /** Answers every call still waiting, as main would, then lets the store take them. */
    async answerAll(override: Partial<Record<CommandName, Wire<unknown>>> = {}) {
      while (waiting.length > 0) {
        for (const call of waiting.splice(0)) {
          call.answer(override[call.name] ?? { ok: true, value: answerTo(call.name, call.input) })
        }
        await new Promise((resolve) => setTimeout(resolve))
      }
    },
  }
}

async function started(size = 3) {
  const fake = fakeBridge(size)
  const ledger = ledgerStore(fake.bridge)
  const stop = ledger.start()
  await fake.answerAll()
  return { fake, ledger, stop }
}

describe('the paths a picker offers', () => {
  test('asked for when a picker first asks, and once per change after that', async () => {
    const { fake, ledger } = await started()
    expect(fake.count('path.list')).toBe(0)

    const first = ledger.paths()
    await fake.answerAll()
    expect(await first).toEqual([])
    expect(fake.count('path.list')).toBe(1)

    fake.forget()
    await ledger.paths()
    expect(fake.count('path.list')).toBe(0)

    fake.notify()
    await fake.answerAll()
    const next = ledger.paths()
    await fake.answerAll()
    await next
    expect(fake.count('path.list')).toBe(1)
  })
})

describe('the ledger store', () => {
  test('starting it loads each list once, and the first page of the ledger', async () => {
    const { fake, ledger } = await started()

    for (const name of LISTS) expect(fake.count(name)).toBe(1)
    expect(fake.pagesAsked()).toEqual([0])
    const state = ledger.current()
    expect(state).toMatchObject({
      total: 3,
      accounts: [{ id: 'a1' }],
      assumedFrom: 'a1',
      failure: null,
      loaded: true,
    })
    expect([0, 1, 2].map((i) => rowAt(state, i)?.id)).toEqual(['t0', 't1', 't2'])
  })

  test('one change notice fetches each list once, however many places listen', async () => {
    const { fake, ledger } = await started()
    const heard: LedgerState[][] = [[], [], []]
    for (const place of heard) ledger.subscribe((state) => place.push(state))

    fake.notify()
    await fake.answerAll()

    for (const name of LISTS) expect(fake.count(name)).toBe(2)
    for (const place of heard) expect(place).toHaveLength(2)
  })

  test('notices while a load is on its way make one more load, not one each', async () => {
    const fake = fakeBridge()
    const ledger = ledgerStore(fake.bridge)
    ledger.start()
    fake.notify()
    fake.notify()
    fake.notify()
    await fake.answerAll()

    for (const name of LISTS) expect(fake.count(name)).toBe(2)
  })

  test('caughtUp waits for the load a notice started, and starts one when none is coming', async () => {
    const { fake, ledger } = await started()

    fake.notify()
    let caught = false
    const waiting = ledger.caughtUp().then(() => {
      caught = true
    })
    expect(caught).toBe(false)
    await fake.answerAll()
    await waiting
    expect(fake.count('account.list')).toBe(2)

    const fresh = ledger.caughtUp()
    await fake.answerAll()
    await fresh
    expect(fake.count('account.list')).toBe(3)
  })

  test('a refused list keeps what it had and says why; the next good load clears it', async () => {
    const { fake, ledger } = await started()

    fake.notify()
    const refused = { ok: false, error: 'UNEXPECTED', detail: undefined } as const
    await fake.answerAll({ 'account.list': refused, 'transaction.page': refused })
    expect(ledger.current()).toMatchObject({ accounts: [{ id: 'a1' }], failure: refused })
    expect(rowAt(ledger.current(), 0)?.id).toBe('t0')

    fake.notify()
    await fake.answerAll()
    expect(ledger.current().failure).toBeNull()
  })

  test('stopping it stops listening', async () => {
    const { fake, stop } = await started()
    stop()

    fake.notify()
    await fake.answerAll()
    expect(fake.count('account.list')).toBe(1)
  })
})

describe("the list's days", () => {
  test('a load brings every day with its count, and each page its days’ nets', async () => {
    const { ledger } = await started(250)
    const state = ledger.current()
    expect(state.days).toEqual([{ date: 'every day', count: 250 }])
    expect([...state.nets]).toEqual([['day 0', [{ amount: '-0.00', currency: 'CAD' }]]])
  })

  test('a page fetched between loads brings its nets; the next load keeps only those in view', async () => {
    const { fake, ledger } = await started(50_000)
    ledger.view(20_090, 20_130)
    await fake.answerAll()
    expect(ledger.current().nets.get('day 20100')).toEqual([
      { amount: '-20100.00', currency: 'CAD' },
    ])

    fake.notify()
    await fake.answerAll()
    expect([...ledger.current().nets.keys()].sort()).toEqual(['day 20000', 'day 20100'])
  })
})

describe('the ledger list, a page at a time, over 50,000 rows', () => {
  const SIZE = 50_000

  test('the view fetches its pages and drops the rest', async () => {
    const { fake, ledger } = await started(SIZE)
    fake.forget()

    ledger.view(20_090, 20_130)
    await fake.answerAll()

    expect(fake.pagesAsked()).toEqual([200, 201])
    const state = ledger.current()
    expect([...state.pages.keys()].sort()).toEqual([200, 201])
    expect(rowAt(state, 20_100)?.id).toBe('t20100')
    expect(rowAt(state, 0)).toBeUndefined()
    expect(indexIn(state, 't20120')).toBe(20_120)
  })

  test('a change notice fetches only the pages in view', async () => {
    const { fake, ledger } = await started(SIZE)
    ledger.view(30_000, 30_040)
    await fake.answerAll()
    fake.forget()

    fake.notify()
    await fake.answerAll()

    expect(fake.pagesAsked()).toEqual([300])
    expect(fake.count('transaction.get')).toBe(0)
  })

  test('jumping to a row far away fetches one page', async () => {
    const { fake, ledger } = await started(SIZE)
    fake.forget()

    const at = ledger.locate('t49999')
    await fake.answerAll()

    expect(await at).toBe(49_999)
    expect(fake.pagesAsked()).toEqual([499])
    expect(rowAt(ledger.current(), 49_999)?.id).toBe('t49999')
  })

  test("a row that's gone has no place", async () => {
    const { fake, ledger } = await started(SIZE)
    fake.gone.add('t40000')

    const at = ledger.locate('t40000')
    await fake.answerAll()

    expect(await at).toBeNull()
  })

  test('a kept row stays when the list scrolls away from it, and goes when it does', async () => {
    const { fake, ledger } = await started(SIZE)
    ledger.keep(['t5', null])
    expect(rowWithId(ledger.current(), 't5')?.id).toBe('t5')

    ledger.view(10_000, 10_040)
    await fake.answerAll()
    expect(rowAt(ledger.current(), 5)).toBeUndefined()
    expect(rowWithId(ledger.current(), 't5')?.id).toBe('t5')

    fake.gone.add('t5')
    fake.notify()
    await fake.answerAll()
    expect(rowWithId(ledger.current(), 't5')).toBeUndefined()
  })

  test("a kept row that isn't held is fetched", async () => {
    const { fake, ledger } = await started(SIZE)
    ledger.keep(['t42000'])
    await fake.answerAll()
    expect(rowWithId(ledger.current(), 't42000')?.id).toBe('t42000')
  })

  test('an opened row stays where it is however far the list scrolls, until it closes', async () => {
    const { fake, ledger } = await started(SIZE)
    ledger.hold('t5')

    ledger.view(10_000, 10_040)
    await fake.answerAll()
    expect(indexIn(ledger.current(), 't5')).toBe(5)
    expect(rowAt(ledger.current(), 5)?.id).toBe('t5')

    fake.forget()
    fake.notify()
    await fake.answerAll()
    expect(fake.pagesAsked().sort((a, b) => a - b)).toEqual([0, 100])
    expect(indexIn(ledger.current(), 't5')).toBe(5)

    ledger.hold(null)
    ledger.view(10_000, 10_040)
    expect(indexIn(ledger.current(), 't5')).toBe(-1)
  })

  test('an opened row pushed onto another page is found there', async () => {
    const { fake, ledger } = await started(SIZE)
    ledger.hold('t5')
    ledger.view(10_000, 10_040)
    await fake.answerAll()

    fake.write(150)
    fake.notify()
    await fake.answerAll()

    expect(indexIn(ledger.current(), 't5')).toBe(155)
    ledger.view(10_000, 10_040)
    expect(indexIn(ledger.current(), 't5')).toBe(155)
  })

  test('an opened row moved onto another page held is held there too', async () => {
    const { fake, ledger } = await started(500)
    ledger.hold('t95')
    ledger.view(80, 120)
    await fake.answerAll()
    expect(indexIn(ledger.current(), 't95')).toBe(95)

    // Ten new spends move it to row 105, on the next page, which the list already draws.
    fake.write(10)
    fake.notify()
    await fake.answerAll()
    expect(indexIn(ledger.current(), 't95')).toBe(105)

    // Scrolling away keeps the page it moved to, so its details stay drawn.
    ledger.view(10_000, 10_040)
    await fake.answerAll()
    expect(indexIn(ledger.current(), 't95')).toBe(105)
  })

  test("an opened row that isn't held is found and its page fetched", async () => {
    const { fake, ledger } = await started(SIZE)
    fake.forget()
    ledger.hold('t42000')
    await fake.answerAll()
    expect(fake.pagesAsked()).toEqual([420])
    expect(indexIn(ledger.current(), 't42000')).toBe(42_000)
  })

  test("a page asked for before a change is dropped: the change's load fetches it fresh", async () => {
    const { fake, ledger } = await started(SIZE)
    ledger.view(500, 540)
    fake.notify()
    await fake.answerAll()

    expect(fake.pagesAsked()).toEqual([0, 5, 5])
    expect([...ledger.current().pages.keys()]).toEqual([5])
  })
})
