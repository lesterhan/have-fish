import { describe, it, expect } from 'bun:test'
import {
  SaveTracker,
  saveErrorMessage,
  SAVED_LINGER_MS,
  type SaveState,
} from './saveState'

/**
 * A hand-cranked clock. The tracker's linger timer is the one piece of behaviour that is
 * about the passage of time, and waiting 1.5s per assertion would make this suite slow and
 * flaky for no gain.
 */
function fakeClock() {
  let next = 1
  const pending = new Map<number, { fn: () => void; due: number }>()
  let now = 0

  return {
    setTimer(fn: () => void, ms: number) {
      const id = next++
      pending.set(id, { fn, due: now + ms })
      return id
    },
    clearTimer(handle: unknown) {
      pending.delete(handle as number)
    },
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...pending]) {
        if (t.due <= now) {
          pending.delete(id)
          t.fn()
        }
      }
    },
    get pendingCount() {
      return pending.size
    },
  }
}

/** A promise plus the handles to settle it, so a save can be held in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A tracker wired to a fake clock, recording every state it emits. */
function harness(fallback = 'Could not save') {
  const clock = fakeClock()
  const seen: SaveState[] = []
  const tracker = new SaveTracker({
    fallbackMessage: fallback,
    onchange: (s) => seen.push(s),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  return { clock, seen, tracker, statuses: () => seen.map((s) => s.status) }
}

describe('SaveTracker', () => {
  it('starts idle and emits nothing until asked to save', () => {
    const { tracker, seen } = harness()
    expect(tracker.state).toEqual({ status: 'idle' })
    expect(seen).toEqual([])
  })

  it('runs idle → saving → saved and returns the value', async () => {
    const { tracker, statuses } = harness()

    const outcome = await tracker.run(async () => 'ok')

    expect(outcome).toEqual({ status: 'saved', value: 'ok' })
    expect(statuses()).toEqual(['saving', 'saved'])
    expect(tracker.state).toEqual({ status: 'saved' })
  })

  it('clears the saved acknowledgement back to idle on its own', async () => {
    const { tracker, clock, statuses } = harness()

    await tracker.run(async () => 1)
    expect(tracker.state.status).toBe('saved')

    clock.advance(SAVED_LINGER_MS - 1)
    expect(tracker.state.status).toBe('saved')

    clock.advance(1)
    expect(tracker.state).toEqual({ status: 'idle' })
    expect(statuses()).toEqual(['saving', 'saved', 'idle'])
  })

  it('turns a rejection into an error carrying the message', async () => {
    const { tracker } = harness()

    const outcome = await tracker.run(async () => {
      throw new Error('Account name already taken')
    })

    expect(outcome).toEqual({
      status: 'error',
      message: 'Account name already taken',
    })
    expect(tracker.state).toEqual({
      status: 'error',
      message: 'Account name already taken',
    })
  })

  it('falls back to its own wording when the failure carries none', async () => {
    const { tracker } = harness('Could not save the name')

    await tracker.run(async () => {
      throw 'not an Error'
    })

    expect(tracker.state).toEqual({
      status: 'error',
      message: 'Could not save the name',
    })
  })

  it('leaves an error standing — nothing times it out', async () => {
    const { tracker, clock } = harness()

    await tracker.run(async () => {
      throw new Error('Server said no')
    })

    clock.advance(SAVED_LINGER_MS * 10)
    expect(tracker.state).toEqual({
      status: 'error',
      message: 'Server said no',
    })
    // An error that schedules nothing cannot silently clear itself later.
    expect(clock.pendingCount).toBe(0)
  })

  it('clears a standing error the moment the next attempt starts', async () => {
    const { tracker, statuses } = harness()

    await tracker.run(async () => {
      throw new Error('Server said no')
    })
    await tracker.run(async () => 'fine')

    expect(statuses()).toEqual(['saving', 'error', 'saving', 'saved'])
  })

  it('cancels a pending linger when a second save starts', async () => {
    const { tracker, clock } = harness()

    await tracker.run(async () => 1)
    expect(clock.pendingCount).toBe(1)

    const second = tracker.run(async () => 2)
    // The first save's fade-to-idle must not fire mid-way through the second save.
    expect(clock.pendingCount).toBe(0)
    await second
    clock.advance(SAVED_LINGER_MS)
    expect(tracker.state).toEqual({ status: 'idle' })
  })

  describe('when a save lands while a later one is still in flight', () => {
    it('reports the newer result, not the one that resolved first', async () => {
      const { tracker } = harness()
      const first = deferred<string>()
      const second = deferred<string>()

      const a = tracker.run(() => first.promise)
      const b = tracker.run(() => second.promise)

      second.resolve('second')
      expect(await b).toEqual({ status: 'saved', value: 'second' })

      first.resolve('first')
      expect(await a).toEqual({ status: 'superseded' })
      // The stale success must not overwrite the newer one's acknowledgement.
      expect(tracker.state).toEqual({ status: 'saved' })
    })

    it('does not let a stale failure raise an error over a newer success', async () => {
      const { tracker, statuses } = harness()
      const first = deferred<string>()
      const second = deferred<string>()

      const a = tracker.run(() => first.promise)
      const b = tracker.run(() => second.promise)

      second.resolve('second')
      await b
      first.reject(new Error('the old request finally failed'))

      expect(await a).toEqual({ status: 'superseded' })
      expect(tracker.state).toEqual({ status: 'saved' })
      expect(statuses()).toEqual(['saving', 'saving', 'saved'])
    })

    it('holds at saving until the newest save settles', async () => {
      const { tracker } = harness()
      const first = deferred<string>()
      const second = deferred<string>()

      const a = tracker.run(() => first.promise)
      const b = tracker.run(() => second.promise)

      first.resolve('first')
      await a
      expect(tracker.state).toEqual({ status: 'saving' })

      second.reject(new Error('the newest one failed'))
      await b
      expect(tracker.state).toEqual({
        status: 'error',
        message: 'the newest one failed',
      })
    })
  })

  describe('reset', () => {
    it('clears a standing error so a reopened surface does not show a stale one', async () => {
      const { tracker, statuses } = harness()

      await tracker.run(async () => {
        throw new Error('Server said no')
      })
      tracker.reset()

      expect(tracker.state).toEqual({ status: 'idle' })
      expect(statuses()).toEqual(['saving', 'error', 'idle'])
    })

    it('drops a pending linger and silences an in-flight save', async () => {
      const { tracker, clock } = harness()
      const inflight = deferred<string>()

      const run = tracker.run(() => inflight.promise)
      tracker.reset()
      inflight.resolve('too late')

      expect(await run).toEqual({ status: 'superseded' })
      expect(tracker.state).toEqual({ status: 'idle' })
      expect(clock.pendingCount).toBe(0)
    })

    it('says nothing when it was already idle', () => {
      const { tracker, seen } = harness()
      tracker.reset()
      expect(seen).toEqual([])
    })
  })

  it('stops reporting once cancelled, and drops its pending timer', async () => {
    const { tracker, clock, statuses } = harness()
    const inflight = deferred<string>()

    const run = tracker.run(() => inflight.promise)
    tracker.cancel()
    inflight.resolve('too late')

    expect(await run).toEqual({ status: 'superseded' })
    expect(statuses()).toEqual(['saving'])
    expect(clock.pendingCount).toBe(0)
  })
})

describe('saveErrorMessage', () => {
  it('prefers the message the API threw', () => {
    expect(
      saveErrorMessage(new Error('Failed to update account'), 'nope'),
    ).toBe('Failed to update account')
  })

  it('falls back for a non-Error, an empty message, and a blank one', () => {
    expect(saveErrorMessage('boom', 'Could not save')).toBe('Could not save')
    expect(saveErrorMessage(new Error(''), 'Could not save')).toBe(
      'Could not save',
    )
    expect(saveErrorMessage(new Error('   '), 'Could not save')).toBe(
      'Could not save',
    )
    expect(saveErrorMessage(undefined, 'Could not save')).toBe('Could not save')
  })

  it('trims the message it does use', () => {
    expect(saveErrorMessage(new Error('  Name taken\n'), 'nope')).toBe(
      'Name taken',
    )
  })
})
