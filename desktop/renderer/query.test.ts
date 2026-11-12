import { describe, expect, test } from 'vitest'
import type { Bridge, Changed, CommandName, Wire } from '../shared/commands'
import { type Ask, type QueryState, query } from './query'
import type { Week } from './report'

type Call = { name: CommandName; input: unknown; answer(value: Wire<unknown>): void }

const A: Week = { start: '2026-11-02', end: '2026-11-08' }
const B: Week = { start: '2026-11-09', end: '2026-11-15' }

/** What the fake answers a call with: the input it was asked, so a value says which load it was. */
const answerFor = (call: Pick<Call, 'input'>) => ({ asked: call.input })

const changedTransaction: Changed[] = [{ type: 'transaction', id: 't1' }]
const changedAccount: Changed[] = [{ type: 'account', id: 'a1' }]

/** A bridge whose answers wait until the test gives them, so a load can be caught mid-way. */
function fakeBridge() {
  const waiting: Call[] = []
  let asked = 0
  let notify: (changed: Changed[]) => void = () => {}
  const bridge = {
    invoke(name: CommandName, input: unknown) {
      return new Promise((resolve) => {
        asked++
        waiting.push({ name, input, answer: resolve })
      })
    },
    onChanged(listener: (changed: Changed[]) => void) {
      notify = listener
      return () => {
        notify = () => {}
      }
    },
  } as unknown as Bridge
  /** Lets every answer given reach the query. */
  const settle = () => new Promise((resolve) => setTimeout(resolve))
  return {
    bridge,
    notify: (changed: Changed[]) => notify(changed),
    /** How many calls the query has made. */
    asked: () => asked,
    /** How many calls wait for an answer. */
    waiting: () => waiting.length,
    settle,
    /** Answers the oldest call waiting, with its input unless told otherwise. */
    async answerNext(answer?: Wire<unknown>) {
      const call = waiting.shift()
      if (call === undefined) throw new Error('nothing is waiting')
      call.answer(answer ?? { ok: true, value: answerFor(call) })
      await settle()
    },
    /** Answers every call waiting, and those they lead to. */
    async answerAll() {
      while (waiting.length > 0) {
        for (const call of waiting.splice(0)) call.answer({ ok: true, value: answerFor(call) })
        await settle()
      }
    },
  }
}

/**
 * A query whose load asks `report.spending` once with its input, whatever `names` it is given, so
 * a test can give it names that read nothing. `heard` is what it emitted after subscribing.
 */
function weekQuery(names: CommandName[] = ['report.spending']) {
  const fake = fakeBridge()
  const spending = query(fake.bridge, names as ['report.spending'], (ask, week: Week) =>
    ask('report.spending', week),
  )
  const stop = spending.start()
  let latest: QueryState<unknown> = { value: null, failure: null }
  const heard: QueryState<unknown>[] = []
  spending.subscribe((state) => {
    latest = state
    heard.push(state)
  })
  heard.splice(0)
  return { fake, spending, heard, stop, state: () => latest }
}

/** A query shown, set to A, and answered. */
async function answered(names?: CommandName[]) {
  const made = weekQuery(names)
  made.spending.show(true)
  made.spending.set(A)
  await made.fake.answerAll()
  return made
}

describe('a query', () => {
  test("an older input's answer is dropped once a newer input's load has started", async () => {
    const { fake, spending, heard, state } = weekQuery()
    spending.show(true)
    spending.set(A)
    spending.set(B)
    await fake.answerNext()

    expect(heard).toEqual([])
    expect(state().value).toBeNull()
  })

  test("the newer input's answer is the value", async () => {
    const { fake, spending, state } = weekQuery()
    spending.show(true)
    spending.set(A)
    spending.set(B)
    await fake.answerNext()
    await fake.answerNext()

    await expect.poll(() => state().value).toEqual({ asked: B })
  })

  test('a change of a kind it reads loads once more, and its answer is the value', async () => {
    const { fake, state } = await answered()
    const before = fake.asked()

    fake.notify(changedTransaction)
    await expect.poll(() => fake.asked()).toBe(before + 1)
    const value = { asked: 'after the change' }
    await fake.answerNext({ ok: true, value })
    await expect.poll(() => state()).toEqual({ value, failure: null })
  })

  test('a change of a kind none of its commands read asks nothing', async () => {
    const { fake } = await answered(['settings.density.get'])
    const before = fake.asked()

    fake.notify(changedTransaction)
    await fake.settle()
    expect(fake.asked()).toBe(before)
  })

  test('each kind its commands read counts: an account changed loads again', async () => {
    const { fake } = await answered(['report.spending'])
    const before = fake.asked()

    fake.notify(changedAccount)
    await expect.poll(() => fake.asked()).toBe(before + 1)
  })

  test('three changes while a load is on its way make one more load, not three', async () => {
    const { fake, spending } = weekQuery()
    spending.show(true)
    spending.set(A)
    fake.notify(changedTransaction)
    fake.notify(changedTransaction)
    fake.notify(changedTransaction)
    await fake.answerAll()

    expect(fake.asked()).toBe(2)
  })

  test('never shown, a set or a change asks nothing', async () => {
    const { fake, spending } = weekQuery()
    spending.set(A)
    await fake.settle()
    expect(fake.asked()).toBe(0)

    fake.notify(changedTransaction)
    await fake.settle()
    expect(fake.asked()).toBe(0)
  })

  test('set while hidden, then shown: exactly one load', async () => {
    const { fake, spending } = weekQuery()
    spending.set(A)
    fake.notify(changedTransaction)
    spending.show(true)

    await expect.poll(() => fake.asked()).toBe(1)
    await fake.answerAll()
    expect(fake.asked()).toBe(1)
  })

  test('hidden and shown again with no change between asks nothing', async () => {
    const { fake, spending } = await answered()
    const before = fake.asked()

    spending.show(false)
    spending.show(true)
    await fake.settle()
    expect(fake.asked()).toBe(before)
  })

  test('a change while hidden, then shown: exactly one load', async () => {
    const { fake, spending } = await answered()
    const before = fake.asked()

    spending.show(false)
    fake.notify(changedTransaction)
    await fake.settle()
    spending.show(true)
    await expect.poll(() => fake.asked()).toBe(before + 1)
    await fake.answerAll()
    expect(fake.asked()).toBe(before + 1)
  })

  test('shown with no input ever set asks nothing', async () => {
    const { fake, spending } = weekQuery()
    spending.show(true)
    await fake.settle()
    expect(fake.asked()).toBe(0)
  })

  test('caughtUp with nothing on its way resolves before any answer is given', async () => {
    const { fake, spending } = weekQuery()
    let caught = false
    void spending.caughtUp().then(() => {
      caught = true
    })

    await expect.poll(() => caught).toBe(true)
    expect(fake.waiting()).toBe(0)
  })

  test('caughtUp waits for the load a change started, and then holds its answer', async () => {
    const { fake, spending, state } = await answered()
    fake.notify(changedTransaction)
    let caught = false
    void spending.caughtUp().then(() => {
      caught = true
    })
    await fake.settle()
    expect(caught).toBe(false)

    const value = { asked: 'after the change' }
    await fake.answerNext({ ok: true, value })
    await expect.poll(() => caught).toBe(true)
    expect(state().value).toEqual(value)
  })

  test('caughtUp waits for the load queued behind the one on its way', async () => {
    const { fake, spending } = await answered()
    fake.notify(changedTransaction)
    fake.notify(changedTransaction)
    let caught = false
    void spending.caughtUp().then(() => {
      caught = true
    })

    await fake.answerNext()
    expect(caught).toBe(false)
    await expect.poll(() => fake.waiting()).toBe(1)
    await fake.answerNext()
    await expect.poll(() => caught).toBe(true)
  })

  test("caughtUp waits for a new input's load, set while one is queued", async () => {
    const { fake, spending, state } = await answered()
    fake.notify(changedTransaction)
    fake.notify(changedTransaction)
    spending.set(B)
    let caught = false
    void spending.caughtUp().then(() => {
      caught = true
    })

    await fake.answerNext()
    expect(caught).toBe(false)
    await fake.answerAll()
    await expect.poll(() => caught).toBe(true)
    expect(state().value).toEqual({ asked: B })
  })

  test('a failed load keeps the last value and says why; the next good load clears it', async () => {
    const { fake, state } = await answered()
    const failure = { ok: false, error: 'UNEXPECTED', detail: undefined } as const

    fake.notify(changedTransaction)
    await expect.poll(() => fake.waiting()).toBe(1)
    await fake.answerNext(failure)
    await expect.poll(() => state()).toEqual({ value: { asked: A }, failure })

    fake.notify(changedTransaction)
    await expect.poll(() => fake.waiting()).toBe(1)
    await fake.answerNext()
    await expect.poll(() => state().failure).toBeNull()
  })

  test('a listener hears the state at once, and nothing after it unsubscribes', async () => {
    const { fake, spending } = weekQuery()
    const heard: QueryState<unknown>[] = []
    const unsubscribe = spending.subscribe((state) => heard.push(state))
    expect(heard).toEqual([{ value: null, failure: null }])

    unsubscribe()
    spending.show(true)
    spending.set(A)
    await fake.answerAll()
    expect(heard).toHaveLength(1)
  })

  test("after start's stop, a change of a kind it reads asks nothing", async () => {
    const { fake, stop } = await answered()
    const before = fake.asked()

    stop()
    fake.notify(changedTransaction)
    await fake.settle()
    expect(fake.asked()).toBe(before)
  })

  test("asking a command the query wasn't given is a compile error", () => {
    const { bridge } = fakeBridge()
    const load = (ask: Ask<'report.spending'>) =>
      // @ts-expect-error: `account.list` isn't one of the query's commands.
      ask('account.list', {})
    expect(query(bridge, ['report.spending'], load)).toBeDefined()
  })
})
