import { describe, expect, test } from 'vitest'
import { groupedOf, indexAt, movedTo, offsetsOf, scrolledTo, uniformOf, windowOf } from './listbox'

const ROW = 33
const BAND = 24

describe('offsetsOf', () => {
  test('each item’s top, then the whole height', () => {
    const offsets = offsetsOf([10, 20, 30])
    expect([0, 1, 2, 3].map((i) => offsets.top(i))).toEqual([0, 10, 30, 60])
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
    for (const scrollTop of [0, 330_000, offsets.top(50_000) - VIEW]) {
      const { from, to } = windowOf(offsets, scrollTop, VIEW)
      expect(to - from).toBeLessThan(100)
      expect(from).toBeLessThanOrEqual(indexAt(offsets, scrollTop))
      expect(to).toBeGreaterThan(indexAt(offsets, scrollTop + VIEW - 1))
    }
  })

  test('the spacers make the scrollbar the whole list’s', () => {
    const { from, to } = windowOf(offsets, 330_000, VIEW)
    const drawn = (to - from) * ROW
    expect(offsets.top(from) + drawn + (offsets.top(50_000) - offsets.top(to))).toBe(50_000 * ROW)
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
      expect(offsets.top(at)).toBeGreaterThanOrEqual(scrollTop)
      expect(offsets.top(at + 1)).toBeLessThanOrEqual(scrollTop + VIEW)
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
    expect(offsets.top(5)).toBe(BAND + 4 * ROW)
    const { from } = windowOf(offsets, offsets.top(5) + BAND + 1, 200, 0)
    expect(from).toBe(6)
    expect(windowOf(offsets, offsets.top(5) + 1, 200, 0).from).toBe(5)
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

  test('keeps an item out from under what covers the top of the view', () => {
    expect(scrolledTo(offsets, 2, 90, 200, 24)).toBe(76)
    expect(scrolledTo(offsets, 2, 76, 200, 24)).toBe(76)
    // The first item covers it with its own band: it scrolls to the top, never past.
    expect(scrolledTo(offsets, 0, 30, 200, 24)).toBe(0)
  })
})

describe('groupedOf: rows in days, each day under its band', () => {
  // Ten years: fourteen rows a day, with a short day here and there.
  const sizes = Array.from({ length: 3_650 }, (_, d) => (d % 7 === 3 ? 2 : 14))
  const count = sizes.reduce((a, b) => a + b, 0)
  const grouped = groupedOf(sizes, ROW, BAND)
  const firsts = new Set(sizes.map((_, d) => sizes.slice(0, d).reduce((a, b) => a + b, 0)))
  const measured = offsetsOf(
    Array.from({ length: count }, (_, r) => (firsts.has(r) ? BAND : 0) + ROW),
  )

  test("lays out as measured would, a day's first row carrying its band, without an array", () => {
    expect(grouped.count).toBe(count)
    for (const r of [0, 1, 13, 14, 15, 44, 45, 46, 20_000, count - 1, count]) {
      expect(grouped.top(r), `row ${r}`).toBe(measured.top(r))
    }
    for (const y of [-5, 0, BAND - 1, BAND, BAND + ROW, 14 * ROW + BAND + 3, 700_000, 10 ** 8]) {
      expect(grouped.indexAt(y), `y ${y}`).toBe(measured.indexAt(y))
    }
  })

  test('says which day a row is in, and whether it starts it', () => {
    expect([0, 13, 14, 43, 44].map((r) => grouped.groupAt(r))).toEqual([0, 0, 1, 3, 4])
    expect([0, 1, 14, 42, 43, 44].map((r) => grouped.starts(r))).toEqual([
      true,
      false,
      true,
      true,
      false,
      true,
    ])
  })

  test('the window and the keys come out as measured', () => {
    expect(windowOf(grouped, 700_000, 600)).toEqual(windowOf(measured, 700_000, 600))
    for (const key of ['ArrowDown', 'PageDown', 'PageUp', 'End', 'Home']) {
      expect(movedTo(grouped, 20_000, key, 600), key).toBe(movedTo(measured, 20_000, key, 600))
    }
  })

  test('none is empty', () => {
    const none = groupedOf([], ROW, BAND)
    expect([none.count, none.top(0), none.indexAt(50)]).toEqual([0, 0, 0])
    expect(windowOf(none, 0, 600)).toEqual({ from: 0, to: 0 })
  })
})

describe('uniformOf', () => {
  const n = 50_000
  const uniform = uniformOf(n, ROW)
  const measured = offsetsOf(Array.from({ length: n }, () => ROW))

  test('lays out as the same heights measured would, without an array of them', () => {
    for (const i of [0, 1, 4_999, n - 1, n]) expect(uniform.top(i)).toBe(measured.top(i))
    for (const y of [-5, 0, 32, 33, 330_000, n * ROW + 100]) {
      expect(uniform.indexAt(y), `y ${y}`).toBe(measured.indexAt(y))
    }
  })

  test('the window and the keys come out the same', () => {
    expect(windowOf(uniform, 330_000, 600)).toEqual(windowOf(measured, 330_000, 600))
    for (const key of ['ArrowDown', 'PageDown', 'PageUp', 'End', 'Home']) {
      expect(movedTo(uniform, 20_000, key, 600), key).toBe(movedTo(measured, 20_000, key, 600))
    }
  })

  test('an empty one draws nothing', () => {
    expect(windowOf(uniformOf(0, ROW), 0, 600)).toEqual({ from: 0, to: 0 })
  })
})
