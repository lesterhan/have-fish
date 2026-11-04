// Where a period's money went, by category, one level at a time: the lines a report shows, and
// the spends behind each.

/** One spend's money in one category, by its name without the root; `''` is unsorted. */
export type Spent = { id: string; category: string; cents: number }

export type SpendingLine = {
  /** Names the line among the level's, for picking it. */
  key: string
  /**
   * `category` is one of the level's categories with everything under it; `own` is what went to
   * the level's category itself; `unsorted` is what went to none.
   */
  kind: 'category' | 'own' | 'unsorted'
  /** The category's name (`food:coffee`); the level's, for `own`; `''` for unsorted. */
  category: string
  /** The last part of its name: what it shows as at this level. */
  label: string
  cents: number
  /** Its part of what went out at this level, from 0 to 1; none below zero. */
  share: number
  /** Whether it has categories under it with money in them, so picking it goes in. */
  opens: boolean
}

/** One level of the breakdown: `''` is the top, else a category's name. */
export type Level = { total: number; lines: SpendingLine[] }

/**
 * The lines at `level`: each category directly under it, with everything under that rolled in,
 * biggest first; then what went to the level's category itself, or at the top, what's unsorted.
 */
export function spendingAt(spent: readonly Spent[], level: string): Level {
  const children = new Map<string, { cents: number; opens: boolean }>()
  let own = 0
  let hasOwn = false
  for (const s of spent) {
    if (!isUnder(s, level) || (level === '' && s.category === '')) continue
    if (s.category === level) {
      own += s.cents
      hasOwn = true
      continue
    }
    const rest = s.category.slice(level === '' ? 0 : level.length + 1)
    const [next = ''] = rest.split(':')
    const category = level === '' ? next : `${level}:${next}`
    const child = children.get(category) ?? { cents: 0, opens: false }
    child.cents += s.cents
    child.opens ||= s.category !== category
    children.set(category, child)
  }

  const lines: Omit<SpendingLine, 'share'>[] = [...children]
    .map(([category, { cents, opens }]) => ({
      key: `category:${category}`,
      kind: 'category' as const,
      category,
      label: labelOf(category),
      cents,
      opens,
    }))
    .sort((a, b) => b.cents - a.cents || byName.compare(a.label, b.label))
  if (hasOwn) {
    lines.push({
      key: `own:${level}`,
      kind: 'own',
      category: level,
      label: labelOf(level),
      cents: own,
      opens: false,
    })
  }
  const unsorted = level === '' ? spent.filter((s) => s.category === '') : []
  if (unsorted.length > 0) {
    const cents = unsorted.reduce((sum, s) => sum + s.cents, 0)
    lines.push({ key: 'unsorted', kind: 'unsorted', category: '', label: '', cents, opens: false })
  }

  const total = lines.reduce((sum, l) => sum + l.cents, 0)
  // Shares of what went out, so money back into one line never stretches the others' bars.
  const out = lines.reduce((sum, l) => sum + Math.max(0, l.cents), 0)
  return {
    total,
    lines: lines.map((l) => ({ ...l, share: out > 0 ? Math.max(0, l.cents) / out : 0 })),
  }
}

/** Whether `s` is behind `line`. */
export function isIn(s: Spent, line: Pick<SpendingLine, 'kind' | 'category'>): boolean {
  if (line.kind === 'unsorted') return s.category === ''
  if (line.kind === 'own') return s.category === line.category
  return isUnder(s, line.category)
}

/** Whether `s` went to `level`'s category or one under it; everything is under the top. */
export function isUnder(s: Spent, level: string): boolean {
  return level === '' || s.category === level || s.category.startsWith(`${level}:`)
}

/** The levels from the top to `level`: `food:coffee` is `food`, then `food:coffee`. */
export function trailTo(level: string): string[] {
  if (level === '') return []
  const parts = level.split(':')
  return parts.map((_, i) => parts.slice(0, i + 1).join(':'))
}

/** The level above `level`; the top is its own. */
export const levelAbove = (level: string) => level.slice(0, Math.max(0, level.lastIndexOf(':')))

const labelOf = (category: string) => category.slice(category.lastIndexOf(':') + 1)

const byName = new Intl.Collator('en', { sensitivity: 'accent' })
