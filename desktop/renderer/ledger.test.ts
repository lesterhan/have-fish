import { describe, expect, test } from 'vitest'
import type { Bridge, Changed, CommandName, Wire } from '../shared/commands'
import { type LedgerState, ledgerStore } from './ledger'

/** What one load asks main for. */
const LISTS: CommandName[] = [
  'transaction.list',
  'account.list',
  'category.list',
  'income.list',
  'spend.assumedFrom',
]

type Call = { name: CommandName; answer(value: Wire<unknown>): void }

/** A bridge whose replies wait until the test gives them, so a load can be caught mid-way. */
function fakeBridge() {
  const calls: Call[] = []
  let notify: (changed: Changed[]) => void = () => {}
  const bridge = {
    invoke: (name: CommandName) =>
      new Promise((resolve) => calls.push({ name, answer: resolve })),
    onChanged(listener: (changed: Changed[]) => void) {
      notify = listener
      return () => {
        notify = () => {}
      }
    },
  } as unknown as Bridge
  const VALUES: Record<string, unknown> = {
    'transaction.list': [{ id: 't1' }],
    'account.list': [{ id: 'a1' }],
    'category.list': [],
    'income.list': [],
    'spend.assumedFrom': { id: 'a1' },
  }
  /** Answers every call still waiting, as main would. */
  async function answerAll(override: Partial<Record<CommandName, Wire<unknown>>> = {}) {
    for (const call of calls.splice(0)) {
      call.answer(override[call.name] ?? { ok: true, value: VALUES[call.name] })
    }
    await new Promise((resolve) => setTimeout(resolve))
  }
  const count = (name: CommandName) => names.filter((n) => n === name).length
  const names: CommandName[] = []
  const tracked = {
    ...bridge,
    invoke: (name: CommandName, input: unknown) => {
      names.push(name)
      return (bridge.invoke as (n: CommandName, i: unknown) => unknown)(name, input)
    },
  } as unknown as Bridge
  return { bridge: tracked, notify: (c: Changed[] = []) => notify(c), answerAll, count, calls }
}

describe('the ledger store', () => {
  test('starting it loads each list once', async () => {
    const fake = fakeBridge()
    const ledger = ledgerStore(fake.bridge)
    ledger.start()
    await fake.answerAll()

    for (const name of LISTS) expect(fake.count(name)).toBe(1)
    expect(ledger.current()).toMatchObject({
      transactions: [{ id: 't1' }],
      accounts: [{ id: 'a1' }],
      assumedFrom: 'a1',
      failure: null,
      loaded: true,
    })
  })

  test('one change notice fetches each list once, however many places listen', async () => {
    const fake = fakeBridge()
    const ledger = ledgerStore(fake.bridge)
    ledger.start()
    await fake.answerAll()
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
    await fake.answerAll()
    await fake.answerAll()

    for (const name of LISTS) expect(fake.count(name)).toBe(2)
  })

  test('caughtUp waits for the load a notice started, and starts one when none is coming', async () => {
    const fake = fakeBridge()
    const ledger = ledgerStore(fake.bridge)
    ledger.start()
    await fake.answerAll()

    fake.notify()
    let caught = false
    const waiting = ledger.caughtUp().then(() => {
      caught = true
    })
    expect(caught).toBe(false)
    await fake.answerAll()
    await waiting
    expect(fake.count('transaction.list')).toBe(2)

    const fresh = ledger.caughtUp()
    await fake.answerAll()
    await fresh
    expect(fake.count('transaction.list')).toBe(3)
  })

  test('a refused list keeps what it had and says why; the next good load clears it', async () => {
    const fake = fakeBridge()
    const ledger = ledgerStore(fake.bridge)
    ledger.start()
    await fake.answerAll()

    fake.notify()
    const refused = { ok: false, error: 'UNEXPECTED', detail: undefined } as const
    await fake.answerAll({ 'account.list': refused })
    expect(ledger.current()).toMatchObject({ accounts: [{ id: 'a1' }], failure: refused })

    fake.notify()
    await fake.answerAll()
    expect(ledger.current().failure).toBeNull()
  })

  test('stopping it stops listening', async () => {
    const fake = fakeBridge()
    const ledger = ledgerStore(fake.bridge)
    const stop = ledger.start()
    await fake.answerAll()
    stop()

    fake.notify()
    await fake.answerAll()
    expect(fake.count('transaction.list')).toBe(1)
  })
})
