// The words on the Reports place: the week's spending as a tree, beside the week before.

export const reports = {
  title: 'Spending',
  /** The popover of a guessed figure's lines. */
  guesses: {
    label: 'The rates this amount guessed',
    borrowed: (day: string, currency: string, rate: string, from: string) =>
      `${day} · ${currency} · using ${rate} from ${from}`,
    missing: (currency: string) => `${currency} · no rate on any day`,
    nearest: 'Use the nearest rates',
  },
  /** Fetching the published rates, in the guessed figure's popover. */
  fetch: {
    open: 'Fetch rates ⚡',
    sends:
      "Fetching sends the currencies and days these amounts need, and your IP address, to frankfurter.dev, which serves the European Central Bank's daily rates.",
    once: 'Allow this once',
  },
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
    /** `+`, before each uncounted amount above zero, all but the first when nothing counted. */
    plus: '+',
    /** `−`, the same place, before a refund the week couldn't count: one below zero. */
    minus: '−',
    change: { more: 'more', less: 'less', same: 'same' },
    total: 'All spending',
    empty: 'No spending in this week or the week before.',
    unsorted: 'Unsorted',
    /** What went to a category itself, beside the ones under it. */
    own: (name: string) => `Just ${name}`,
  },
  spends: {
    label: 'Its spends',
    /** A row with nothing spent on it this week, so its spends list has nothing. */
    nothing: 'Nothing in the week shown.',
  },
  card: { label: 'The spend picked' },
}
