import { describe, expect, test } from 'vitest'
import { indexAt, movedTo, offsetsOf, scrolledTo, windowOf } from './listbox'

const ROW = 33
const BAND = 24

describe('offsetsOf', () => {
  test('each item’s top, then the whole height', () => {
    expect([...offsetsOf([10, 20, 30])]).toEqual([0, 10, 30, 60])
  })
})

describe('indexAt', () => {
  const offsets = offsetsOf([10, 20, 30])
  test.each([
    [0, 0],
    [9, 0],
    [10, 1],
    [29, 1],
    [30, 2],
    [59, 2],
    [500, 2],
  ])('y %i is in item %i', (y, i) => {
    expect(indexAt(offsets, y)).toBe(i)
  })
})

describe('a windowed list of 50,000', () => {
  const offsets = offsetsOf(Array.from({ length: 50_000 }, () => ROW))
  const VIEW = 600

  test('draws under a hundred rows, wherever it is scrolled', () => {
    for (const scrollTop of [0, 330_000, Number(offsets[50_000]) - VIEW]) {
      const { from, to } = windowOf(offsets, scrollTop, VIEW)
      expect(to - from).toBeLessThan(100)
      expect(from).toBeLessThanOrEqual(indexAt(offsets, scrollTop))
      expect(to).toBeGreaterThan(indexAt(offsets, scrollTop + VIEW - 1))
    }
  })

  test('the spacers make the scrollbar the whole list’s', () => {
    const { from, to } = windowOf(offsets, 330_000, VIEW)
    const drawn = (to - from) * ROW
    expect(Number(offsets[from]) + drawn + (Number(offsets[50_000]) - Number(offsets[to]))).toBe(
      50_000 * ROW,
    )
  })

  test('Down, PageDown, Home and End move past the drawn window, and it follows', () => {
    let at = 0
    let scrollTop = 0
    const press = (key: string) => {
      at = movedTo(offsets, at, key, VIEW) ?? at
      scrollTop = scrolledTo(offsets, at, scrollTop, VIEW)
      const { from, to } = windowOf(offsets, scrollTop, VIEW)
      expect(at).toBeGreaterThanOrEqual(from)
      expect(at).toBeLessThan(to)
      expect(Number(offsets[at])).toBeGreaterThanOrEqual(scrollTop)
      expect(Number(offsets[at + 1])).toBeLessThanOrEqual(scrollTop + VIEW)
    }

    for (let i = 0; i < 30; i++) press('ArrowDown')
    expect(at).toBe(30)
    press('PageDown')
    expect(at).toBe(30 + Math.floor(VIEW / ROW))
    press('End')
    expect(at).toBe(49_999)
    press('ArrowDown')
    expect(at).toBe(49_999)
    press('PageUp')
    expect(at).toBe(49_999 - Math.floor(VIEW / ROW))
    press('Home')
    expect([at, scrollTop]).toEqual([0, 0])
  })
})

describe('items of more than one height', () => {
  // A band of a day, then its four rows, ten days over.
  const heights = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? BAND : ROW))
  const offsets = offsetsOf(heights)

  test('after scrolling past a band, the window starts at the row that shows', () => {
    // The second day's band is at 156; just past it is its first row.
    expect(Number(offsets[5])).toBe(BAND + 4 * ROW)
    const { from } = windowOf(offsets, Number(offsets[5]) + BAND + 1, 200, 0)
    expect(from).toBe(6)
    expect(windowOf(offsets, Number(offsets[5]) + 1, 200, 0).from).toBe(5)
  })

  test('the window ends at the last item that shows', () => {
    const { to } = windowOf(offsets, 0, BAND + ROW + 1, 0)
    expect(to).toBe(3)
  })
})

describe('movedTo', () => {
  const offsets = offsetsOf([ROW, ROW, ROW, ROW])

  test('from nothing, Down takes the first', () => {
    expect(movedTo(offsets, -1, 'ArrowDown', 100)).toBe(0)
  })

  test('a key that doesn’t move is undefined, and an empty list moves nowhere', () => {
    expect(movedTo(offsets, 1, 'a', 100)).toBeUndefined()
    expect(movedTo(offsetsOf([]), -1, 'ArrowDown', 100)).toBeUndefined()
  })

  test('stops at the ends, or wraps when asked', () => {
    expect(movedTo(offsets, 3, 'ArrowDown', 100)).toBe(3)
    expect(movedTo(offsets, 3, 'ArrowDown', 100, { wrap: true })).toBe(0)
    expect(movedTo(offsets, 0, 'ArrowUp', 100, { wrap: true })).toBe(3)
  })

  test('steps over an item that can’t be chosen', () => {
    const skip = (i: number) => i === 1 || i === 3
    expect(movedTo(offsets, 0, 'ArrowDown', 100, { skip })).toBe(2)
    expect(movedTo(offsets, 2, 'ArrowDown', 100, { skip })).toBe(2)
    expect(movedTo(offsets, -1, 'End', 100, { skip })).toBe(2)
    expect(movedTo(offsetsOf([ROW, ROW]), -1, 'Home', 100, { skip: (i) => i === 0 })).toBe(1)
  })
})

describe('scrolledTo', () => {
  const offsets = offsetsOf(Array.from({ length: 10 }, () => 50))

  test('leaves the list where it is when the item shows', () => {
    expect(scrolledTo(offsets, 2, 50, 200)).toBe(50)
  })

  test('scrolls just enough, up or down', () => {
    expect(scrolledTo(offsets, 6, 50, 200)).toBe(150)
    expect(scrolledTo(offsets, 0, 50, 200)).toBe(0)
  })
})
