// The tab pattern's keys, read without a DOM: ← and → wrap, Home and End go to the ends.

/** The tab `key` moves to from tab `at` of `count`; null for a key that moves none. */
export function tabAfter(key: string, at: number, count: number): number | null {
  if (count === 0) return null
  switch (key) {
    case 'ArrowRight':
      return (at + 1) % count
    case 'ArrowLeft':
      return (at - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
