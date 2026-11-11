// run()'s page is stubbed: the desktop tests run on Electron's Node, which has Event but no
// document, KeyboardEvent or requestAnimationFrame of its own.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Replay } from './bridge'
import type { Step } from './scenes'
import { run } from './steps'

class FakeElement {
  clicked = 0
  events: Event[] = []
  click() {
    this.clicked += 1
  }
  dispatchEvent(event: Event): boolean {
    this.events.push(event)
    return true
  }
}

class FakeKeyboardEvent extends Event {
  key: string
  constructor(type: string, init: { key: string; bubbles?: boolean }) {
    super(type, init)
    this.key = init.key
  }
}

let cursor: FakeElement
let found: unknown
let frames: number

beforeEach(() => {
  cursor = new FakeElement()
  found = new FakeElement()
  frames = 0
  Object.assign(globalThis, {
    document: {
      activeElement: cursor,
      body: new FakeElement(),
      querySelector: () => found,
    },
    HTMLElement: FakeElement,
    KeyboardEvent: FakeKeyboardEvent,
    requestAnimationFrame: (then: () => void) => {
      frames += 1
      then()
      return 0
    },
  })
})

afterEach(() => {
  for (const name of ['document', 'HTMLElement', 'KeyboardEvent', 'requestAnimationFrame']) {
    Reflect.deleteProperty(globalThis, name)
  }
})

/** A bridge stub: only `act` can be called on it, and it remembers. `as unknown`: the rest of
 * Replay is never touched by run(). */
function aBridge(sent: string[] = []): Replay {
  return { act: (id: string) => sent.push(id) } as unknown as Replay
}

describe('run', () => {
  test('an action goes through act, as the menu would send it', async () => {
    const sent: string[] = []
    await run([{ action: 'showReports' }], aBridge(sent))
    expect(sent).toEqual(['showReports'])
  })

  test('a key goes to whatever has the cursor', async () => {
    await run([{ key: 'Enter' }], aBridge())
    expect(cursor.events).toHaveLength(1)
    const event = cursor.events[0] as FakeKeyboardEvent
    expect(event.type).toBe('keydown')
    expect(event.key).toBe('Enter')
    expect(event.bubbles).toBe(true)
  })

  test('a click clicks the first element the selector finds', async () => {
    await run([{ click: 'li.row' }], aBridge())
    expect((found as FakeElement).clicked).toBe(1)
  })

  test('a click that finds nothing, or nothing clickable, throws', async () => {
    found = null
    await expect(run([{ click: 'li.nope' }], aBridge())).rejects.toThrow(/li\.nope/)
    found = { svg: true }
    await expect(run([{ click: 'svg' }], aBridge())).rejects.toThrow(/svg/)
  })

  test('each step, then a frame', async () => {
    const steps: Step[] = [{ action: 'showReports' }, { key: 'Enter' }]
    await run(steps, aBridge())
    expect(frames).toBe(2)
  })
})
