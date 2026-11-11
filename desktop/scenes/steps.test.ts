// run()'s page is stubbed: the desktop tests run on Electron's Node, which has Event but no
// document, KeyboardEvent or requestAnimationFrame of its own.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Replay } from './bridge'
import type { Step } from './scenes'
import { play, run } from './steps'

class FakeElement {
  clicked = 0
  focused = 0
  value = ''
  dataset: Record<string, string> = {}
  events: Event[] = []
  click() {
    this.clicked += 1
  }
  focus() {
    this.focused += 1
    active = this
  }
  dispatchEvent(event: Event): boolean {
    this.events.push(event)
    return true
  }
}

/** A field a fill can type in; the click and key steps see it as any element. */
class FakeInput extends FakeElement {}

class FakeKeyboardEvent extends Event {
  key: string
  constructor(type: string, init: { key: string; bubbles?: boolean }) {
    super(type, init)
    this.key = init.key
  }
}

let cursor: FakeElement
let active: FakeElement
let found: unknown
let frames: number

beforeEach(() => {
  cursor = new FakeElement()
  active = cursor
  found = new FakeElement()
  frames = 0
  Object.assign(globalThis, {
    document: {
      get activeElement() {
        return active
      },
      body: new FakeElement(),
      querySelector: () => found,
    },
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeInput,
    KeyboardEvent: FakeKeyboardEvent,
    requestAnimationFrame: (then: () => void) => {
      frames += 1
      then()
      return 0
    },
  })
})

afterEach(() => {
  for (const name of [
    'document',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'KeyboardEvent',
    'requestAnimationFrame',
  ]) {
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

  test('a fill step focuses its field, sets the text and says it changed', async () => {
    const field = new FakeInput()
    found = field
    await run([{ fill: 'input[name=from]', text: 'Lunch' }, { key: 'ArrowDown' }], aBridge())
    expect(field.focused).toBe(1)
    expect(field.value).toBe('Lunch')
    const typed = field.events.find((event) => event.type === 'input')
    expect(typed).toBeDefined()
    expect(typed?.bubbles).toBe(true)
    // The key after it lands on the field that was filled, as it would after typing.
    expect(field.events.some((event) => event.type === 'keydown')).toBe(true)
  })

  test('a fill step that finds nothing throws, naming its selector', async () => {
    found = null
    await expect(run([{ fill: 'input[name=from]', text: 'x' }], aBridge())).rejects.toThrow(
      /input\[name=from\]/,
    )
    // A button isn't a field, even though it is an element.
    found = new FakeElement()
    await expect(run([{ fill: 'button', text: 'x' }], aBridge())).rejects.toThrow(/button/)
  })
})

describe('play', () => {
  test('marks the page ready only once its steps have run and its fonts are in', async () => {
    const frames: (() => void)[] = []
    let fontsIn = () => {}
    const fonts = new Promise<void>((done) => {
      fontsIn = done
    })
    Object.assign(globalThis, {
      requestAnimationFrame: (then: () => void) => frames.push(then),
    })
    Object.assign(document, { fonts: { ready: fonts } })
    const body = document.body as unknown as FakeElement
    const tick = () => new Promise((done) => setTimeout(done, 0))

    const playing = play([{ key: 'Enter' }], aBridge())
    await tick()
    // The step waits on a frame that hasn't drawn.
    expect(body.dataset.scene).toBeUndefined()

    for (const draw of frames.splice(0)) draw()
    await tick()
    // The steps are done, the fonts aren't.
    expect(body.dataset.scene).toBeUndefined()

    fontsIn()
    await playing
    expect(body.dataset.scene).toBe('ready')
  })
})
