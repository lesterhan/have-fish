// Where a period's money went, by category, and how each line compares with the period before:
// the rows a report shows as a tree, and the spends behind each.

import { type Mark, weaker } from './rate-for'

/** One spend's money in one category, and its rate's mark; `''` is unsorted. */
export type Spent = { id: string; category: string; cents: number; mark: Mark }

export type SpendingLine = {
  /** Names the line among the level's, for picking it. */
  key: string
  /**
   * `category` is one of the level's categories with everything under it; `own` is what went to
   * the level's category itself; `unsorted` is what went to none.
   */
  holds: 'category' | 'own' | 'unsorted'
  /** The category's name (`food:coffee`); the level's, for `own`; `''` for unsorted. */
  category: string
  /** The last part of its name: what it shows as at this level. */
  label: string
  cents: number
  /** The weakest mark of the spends in it. */
  mark: Mark
  /** Whether it has categories under it with money in them, so the tree can open it. */
  opens: boolean
}

/** One level of the breakdown: `''` is the top, else a category's name. */
export type Level = { total: number; mark: Mark; lines: SpendingLine[] }

/** A level's line with the period before beside it: a sum, or null when nothing went to it. */
export type ComparedLine = Omit<SpendingLine, 'cents' | 'mark'> & {
  /** This period's. */
  cents: number | null
  /** The period before's, the same way. */
  before: number | null
  /** This period's weakest mark; null with no sum. */
  mark: Mark | null
  /** The period before's, the same way. */
  beforeMark: Mark | null
}

/** One level beside the period before: both sums, and each line's two. */
export type Compared = {
  total: number
  before: number
  mark: Mark
  beforeMark: Mark
  lines: ComparedLine[]
}

/**
 * The lines at `level`: each category directly under it, with everything under that rolled in,
 * in the order its spends came; then what went to the level's category itself, or at the top,
 * what's unsorted. Ordering them is `comparedAt`'s.
 */
export function spendingAt(spent: readonly Spent[], level: string): Level {
  const children = new Map<string, Child>()
  let own = 0
  let ownMark: Mark = 'exact'
  let hasOwn = false
  for (const s of spent) {
    if (!isUnder(s, level) || (level === '' && s.category === '')) continue
    if (s.category === level) {
      own += s.cents
      ownMark = weaker(ownMark, s.mark)
      hasOwn = true
      continue
    }
    const rest = s.category.slice(level === '' ? 0 : level.length + 1)
    const [next = ''] = rest.split(':')
    const category = level === '' ? next : `${level}:${next}`
    const child: Child = children.get(category) ?? { cents: 0, mark: 'exact', opens: false }
    child.cents += s.cents
    child.mark = weaker(child.mark, s.mark)
    child.opens ||= s.category !== category
    children.set(category, child)
  }

  // Their order is `comparedAt`'s: this level's lines are worked out once, then sorted with the
  // week before beside them.
  const lines: SpendingLine[] = [...children].map(([category, { cents, mark, opens }]) => ({
    key: `category:${category}`,
    holds: 'category' as const,
    category,
    label: labelOf(category),
    cents,
    mark,
    opens,
  }))
  if (hasOwn) {
    lines.push({
      key: `own:${level}`,
      holds: 'own',
      category: level,
      label: labelOf(level),
      cents: own,
      mark: ownMark,
      opens: false,
    })
  }
  const unsorted = level === '' ? spent.filter((s) => s.category === '') : []
  if (unsorted.length > 0) {
    const cents = unsorted.reduce((sum, s) => sum + s.cents, 0)
    lines.push({
      key: 'unsorted',
      holds: 'unsorted',
      category: '',
      label: '',
      cents,
      mark: weakest(unsorted.map((s) => s.mark)),
      opens: false,
    })
  }

  const total = lines.reduce((sum, l) => sum + l.cents, 0)
  return { total, mark: weakest(lines.map((l) => l.mark)), lines }
}

/** A category's line as `spendingAt` sums it. */
type Child = { cents: number; mark: Mark; opens: boolean }

/** The weakest of `marks`; `exact` with none, the one every mark is weaker than. */
const weakest = (marks: readonly Mark[]): Mark =>
  marks.reduce<Mark>((so, mark) => weaker(so, mark), 'exact')

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
  const add = (at: Level, sum: 'cents' | 'before', mark: 'mark' | 'beforeMark') => {
    for (const line of at.lines) {
      const kept = lines.get(line.key) ?? {
        ...line,
        cents: null,
        before: null,
        mark: null,
        beforeMark: null,
      }
      kept[sum] = line.cents
      kept[mark] = line.mark
      kept.opens ||= line.opens
      lines.set(line.key, kept)
    }
  }
  add(now, 'cents', 'mark')
  add(then, 'before', 'beforeMark')
  const all = [...lines.values()]
  return {
    total: now.total,
    before: then.total,
    mark: now.mark,
    beforeMark: then.mark,
    lines: [
      ...all.filter((l) => l.holds === 'category').sort(biggerFirst),
      ...all.filter((l) => l.holds === 'own'),
      ...all.filter((l) => l.holds === 'unsorted'),
    ],
  }
}

/** Whether `s` is behind `line`: only its category is read, so a reported spend can ask. */
export function isIn(
  s: Pick<Spent, 'category'>,
  line: Pick<SpendingLine, 'holds' | 'category'>,
): boolean {
  if (line.holds === 'unsorted') return s.category === ''
  if (line.holds === 'own') return s.category === line.category
  return isUnder(s, line.category)
}

/** Whether `s` went to `level`'s category or one under it; everything is under the top. */
export function isUnder(s: Pick<Spent, 'category'>, level: string): boolean {
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
