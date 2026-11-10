// The words on the Reports place: the week's spending as a tree, beside the week before.

export const reports = {
  title: 'Spending',
  week: {
    label: 'The week shown',
    /** The buttons' words, read out; they show as arrows. */
    before: 'The week before',
    after: 'The week after',
    earlier: '◀',
    later: '▶',
    thisWeek: 'This week',
    /** Monday to Sunday, as two dates. */
  },
  /** The header's quiet line: what went out, against the week before. */
  sum: {
    thisWeek: (spent: string, before: string) => `Spent ${spent}, against ${before} last week`,
    another: (spent: string, before: string) => `Spent ${spent}, against ${before} the week before`,
  },
  tree: {
    label: 'Spending by category',
    headings: {
      name: 'Where it went',
      thisWeek: { shown: 'This week', before: 'Last week' },
      another: { shown: 'That week', before: 'Week before' },
      change: 'Change',
    },
    /** A category with categories under it: closed, then open. */
    closed: '▶',
    open: '▼',
    /** A week with nothing spent on it. */
    dash: '–',
    change: { more: 'more', less: 'less', same: 'same' },
    total: 'All spending',
    empty: 'No spending in this week or the week before.',
    unsorted: 'Unsorted',
    /** What went to a category itself, beside the ones under it. */
    own: (name: string) => `Just ${name}`,
    /** What went to categories in currencies these totals can't add in yet. */
    other: (amounts: string) => `Not in these totals, in other currencies: ${amounts}`,
  },
  spends: {
    label: 'Its spends',
    /** A row with nothing spent on it this week, so its spends list has nothing. */
    nothing: 'Nothing in the week shown.',
  },
  card: { label: 'The spend picked' },
}
