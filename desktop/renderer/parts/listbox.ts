// A listbox's rules, without a DOM: which items to draw for where it's scrolled, where a key moves
// the active item, and how far to scroll to show it. Items may differ in height (a day's band is
// shorter than a row), so everything works from each item's top.

/** Rows drawn beyond each edge of the view, so a fast scroll doesn't show a gap. */
export const OVERSCAN = 6

/** A list the window holds only some of: its length, and the item at an index if it's here. */
export type Paged<T> = {
  count: number
  at: (index: number) => T | undefined
  /** Where the item with this id is, if it's here; else -1. */
  indexOf: (id: string) => number
}

/** Where each item sits: `top(i)` is item i's, `top(count)` the list's whole height. */
export type Layout = { readonly count: number; top(i: number): number; indexAt(y: number): number }

/** Items of these heights, which may differ: a day's band is shorter than a row. */
export function offsetsOf(heights: readonly number[]): Layout {
  const offsets = new Float64Array(heights.length + 1)
  for (let i = 0; i < heights.length; i++)
    offsets[i + 1] = (offsets[i] as number) + (heights[i] as number)
  const count = heights.length
  const top = (i: number) => offsets[i] as number
  return {
    count,
    top,
    // A binary search, so 50,000 costs 16 steps.
    indexAt(y) {
      let low = 0
      let high = count - 1
      while (low < high) {
        const mid = (low + high + 1) >> 1
        if (top(mid) <= y) low = mid
        else high = mid - 1
      }
      return Math.max(low, 0)
    },
  }
}

/** `count` items of one height, worked out rather than stored: a paged list of any length. */
export function uniformOf(count: number, height: number): Layout {
  return {
    count,
    top: (i) => i * height,
    indexAt: (y) => Math.max(Math.min(Math.floor(y / height), count - 1), 0),
  }
}

/** A layout of rows in groups, each under a band: which group a row is in, and if it's the first. */
export type Grouped = Layout & { groupAt(row: number): number; starts(row: number): boolean }

/**
 * Rows in groups of `sizes`, each group's first row carrying its band above it: a day and its rows.
 * Worked out from the groups, so ten years of days costs an array of days, not of rows.
 */
export function groupedOf(sizes: readonly number[], row: number, band: number): Grouped {
  const firsts = new Float64Array(sizes.length + 1)
  for (let g = 0; g < sizes.length; g++)
    firsts[g + 1] = (firsts[g] as number) + (sizes[g] as number)
  const groups = sizes.length
  const count = firsts[groups] as number
  const startOf = (g: number) => firsts[g] as number
  /** The last group whose value from `at` is at or below `x`: a binary search. */
  const lastAtOrBelow = (x: number, at: (g: number) => number) => {
    let low = 0
    let high = groups - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (at(mid) <= x) low = mid
      else high = mid - 1
    }
    return low
  }
  const groupAt = (r: number) => lastAtOrBelow(r, startOf)
  const groupTop = (g: number) => startOf(g) * row + g * band
  const starts = (r: number) => r < count && startOf(groupAt(r)) === r
  return {
    count,
    groupAt,
    starts,
    // The bands above it: its own day's, unless it carries that one itself.
    top: (r) =>
      r >= count
        ? count * row + groups * band
        : r * row + (groupAt(r) + (starts(r) ? 0 : 1)) * band,
    indexAt(y) {
      if (count === 0) return 0
      const g = lastAtOrBelow(y, groupTop)
      const into = Math.max(Math.floor((y - groupTop(g) - band) / row), 0)
      return Math.min(startOf(g) + into, startOf(g + 1) - 1, count - 1)
    },
  }
}

/** The item at height `y`, clamped to the list. */
export const indexAt = (layout: Layout, y: number): number => layout.indexAt(y)

/** The items to draw, `from` up to but not `to`, for the view at `scrollTop`. */
export function windowOf(
  offsets: Layout,
  scrollTop: number,
  viewport: number,
  overscan = OVERSCAN,
): { from: number; to: number } {
  const n = offsets.count
  if (n === 0) return { from: 0, to: 0 }
  const first = indexAt(offsets, scrollTop)
  const last = indexAt(offsets, scrollTop + Math.max(viewport, 1) - 1)
  return { from: Math.max(first - overscan, 0), to: Math.min(last + 1 + overscan, n) }
}

type Moving = { wrap?: boolean; skip?: (index: number) => boolean }

/**
 * Where `key` moves the active item from `index` (-1 for none); undefined for a key that doesn't
 * move it, or a list with nothing to move to. Page keys move by the view's height.
 */
export function movedTo(
  offsets: Layout,
  index: number,
  key: string,
  viewport: number,
  { wrap = false, skip = () => false }: Moving = {},
): number | undefined {
  const n = offsets.count
  if (n === 0) return undefined
  const from = Math.min(index, n - 1)
  const top = from < 0 ? 0 : offsets.top(from)
  const raw: Record<string, () => [number, 1 | -1]> = {
    ArrowDown: () => [from < 0 ? 0 : wrap && from === n - 1 ? 0 : from + 1, 1],
    ArrowUp: () => [from < 0 ? 0 : wrap && from === 0 ? n - 1 : from - 1, -1],
    PageDown: () => [from < 0 ? 0 : indexAt(offsets, top + viewport), 1],
    PageUp: () => [from < 0 ? 0 : wholeFrom(offsets, top - viewport), -1],
    Home: () => [0, 1],
    End: () => [n - 1, -1],
  }
  const step = raw[key]
  if (step === undefined) return undefined
  const [target, way] = step()
  const clamped = Math.min(Math.max(target, 0), n - 1)
  const found = choosable(clamped, way, n, skip) ?? choosable(clamped, way === 1 ? -1 : 1, n, skip)
  return found ?? (from >= 0 ? from : undefined)
}

/** The first item whose top is at or below `y`. */
function wholeFrom(offsets: Layout, y: number): number {
  if (y <= 0) return 0
  const i = indexAt(offsets, y)
  return offsets.top(i) < y ? i + 1 : i
}

/** The first item from `i` going `way` that can be chosen. */
function choosable(i: number, way: 1 | -1, n: number, skip: (i: number) => boolean) {
  for (let j = i; j >= 0 && j < n; j += way) if (!skip(j)) return j
  return undefined
}

/**
 * Where to scroll so item `index` shows whole: as little as it takes, or not at all. `covered` is
 * what sits over the top of the view, a day's band that stays while rows pass under it.
 */
export function scrolledTo(
  offsets: Layout,
  index: number,
  scrollTop: number,
  viewport: number,
  covered = 0,
): number {
  if (index < 0 || index >= offsets.count) return scrollTop
  const top = offsets.top(index)
  const bottom = offsets.top(index + 1)
  if (top < scrollTop + covered) return Math.max(top - covered, 0)
  if (bottom > scrollTop + viewport) return bottom - viewport
  return scrollTop
}
