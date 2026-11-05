// A listbox's rules, without a DOM: which items to draw for where it's scrolled, where a key moves
// the active item, and how far to scroll to show it. Items may differ in height (a day's band is
// shorter than a row), so everything works from each item's top.

/** Rows drawn beyond each edge of the view, so a fast scroll doesn't show a gap. */
export const OVERSCAN = 6

/** Each item's top, then the whole height: `offsets[i]` is item i's, `offsets[n]` the list's. */
export function offsetsOf(heights: readonly number[]): Float64Array {
  const offsets = new Float64Array(heights.length + 1)
  for (let i = 0; i < heights.length; i++)
    offsets[i + 1] = (offsets[i] as number) + (heights[i] as number)
  return offsets
}

const count = (offsets: Float64Array) => offsets.length - 1
const at = (offsets: Float64Array, i: number) => offsets[i] as number

/** The item at height `y`, clamped to the list: a binary search, so 50,000 costs 16 steps. */
export function indexAt(offsets: Float64Array, y: number): number {
  let low = 0
  let high = count(offsets) - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (at(offsets, mid) <= y) low = mid
    else high = mid - 1
  }
  return Math.max(low, 0)
}

/** The items to draw, `from` up to but not `to`, for the view at `scrollTop`. */
export function windowOf(
  offsets: Float64Array,
  scrollTop: number,
  viewport: number,
  overscan = OVERSCAN,
): { from: number; to: number } {
  const n = count(offsets)
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
  offsets: Float64Array,
  index: number,
  key: string,
  viewport: number,
  { wrap = false, skip = () => false }: Moving = {},
): number | undefined {
  const n = count(offsets)
  if (n === 0) return undefined
  const from = Math.min(index, n - 1)
  const top = from < 0 ? 0 : at(offsets, from)
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
function wholeFrom(offsets: Float64Array, y: number): number {
  if (y <= 0) return 0
  const i = indexAt(offsets, y)
  return at(offsets, i) < y ? i + 1 : i
}

/** The first item from `i` going `way` that can be chosen. */
function choosable(i: number, way: 1 | -1, n: number, skip: (i: number) => boolean) {
  for (let j = i; j >= 0 && j < n; j += way) if (!skip(j)) return j
  return undefined
}

/** Where to scroll so item `index` shows whole: as little as it takes, or not at all. */
export function scrolledTo(
  offsets: Float64Array,
  index: number,
  scrollTop: number,
  viewport: number,
): number {
  if (index < 0 || index >= count(offsets)) return scrollTop
  const top = at(offsets, index)
  const bottom = at(offsets, index + 1)
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewport) return bottom - viewport
  return scrollTop
}
