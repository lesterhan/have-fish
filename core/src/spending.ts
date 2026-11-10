// Where a period's money went, by category, and how each line compares with the period before:
// the rows a report shows as a tree, and the spends behind each.

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
  /** Whether it has categories under it with money in them, so the tree can open it. */
  opens: boolean
}

/** One level of the breakdown: `''` is the top, else a category's name. */
export type Level = { total: number; lines: SpendingLine[] }

/** A level's line with the period before beside it: a sum, or null when nothing went to it. */
export type ComparedLine = Omit<SpendingLine, 'cents'> & {
  /** This period's. */
  cents: number | null
  /** The period before's, the same way. */
  before: number | null
}

/** One level beside the period before: both sums, and each line's two. */
export type Compared = { total: number; before: number; lines: ComparedLine[] }

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

  // Their order is `comparedAt`'s: this level's lines are worked out once, then sorted with the
  // week before beside them.
  const lines: SpendingLine[] = [...children].map(([category, { cents, opens }]) => ({
    key: `category:${category}`,
    kind: 'category' as const,
    category,
    label: labelOf(category),
    cents,
    opens,
  }))
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
  return { total, lines }
}

/**
 * The same level beside the period before: each line's two sums, this period's biggest first,
 * then the one before's, then by name; what went to the level's own category and what's unsorted
 * last, whatever their size.
 */
export function comparedAt(
  shown: readonly Spent[],
  before: readonly Spent[],
  level: string,
): Compared {
  const now = spendingAt(shown, level)
  const then = spendingAt(before, level)
  const lines = new Map<string, ComparedLine>()
  const add = (at: Level, week: 'cents' | 'before') => {
    for (const line of at.lines) {
      const kept = lines.get(line.key) ?? { ...line, cents: null, before: null }
      kept[week] = line.cents
      kept.opens ||= line.opens
      lines.set(line.key, kept)
    }
  }
  add(now, 'cents')
  add(then, 'before')
  const all = [...lines.values()]
  return {
    total: now.total,
    before: then.total,
    lines: [
      ...all.filter((l) => l.kind === 'category').sort(biggerFirst),
      ...all.filter((l) => l.kind === 'own'),
      ...all.filter((l) => l.kind === 'unsorted'),
    ],
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

/** This period's biggest first, then the one before's; a week with nothing last. */
const biggerFirst = (a: ComparedLine, b: ComparedLine) => {
  if (a.cents !== b.cents) {
    if (a.cents === null) return 1
    if (b.cents === null) return -1
    return b.cents - a.cents
  }
  if (a.before !== b.before) {
    if (a.before === null) return 1
    if (b.before === null) return -1
    return b.before - a.before
  }
  return byName.compare(a.label, b.label)
}

const labelOf = (category: string) => category.slice(category.lastIndexOf(':') + 1)

const byName = new Intl.Collator('en', { sensitivity: 'accent' })
