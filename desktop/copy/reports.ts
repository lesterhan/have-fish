// The words on the Reports place: a week's spending by category.

export const reports = {
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
  trail: {
    label: 'Where you are in your categories',
    top: 'All spending',
    /** Between a category and the one under it, as names are written. */
    between: ':',
  },
  breakdown: {
    label: 'Spending by category',
    unsorted: 'Unsorted',
    /** What went to a category itself, beside the ones under it. */
    own: (name: string) => `Just ${name}`,
    /** Beside a category with categories under it: picking it goes in. */
    opens: '›',
    total: 'Spent',
    nothing: 'No spending in this week.',
    /** What went to categories in currencies these totals can't add in yet. */
    other: (amounts: string) => `Not in these totals, in other currencies: ${amounts}`,
  },
  spends: { label: 'Its spends' },
  pane: { label: 'The spend picked' },
}
