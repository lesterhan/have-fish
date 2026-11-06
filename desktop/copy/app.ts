// The app's own name, the window's title and the page's, and its places down the left.

export const app = {
  name: 'have-fish',
  places: { label: 'Places', ledger: 'Ledger', accounts: 'Accounts', reports: 'Reports' },
  /** What stopped something, under a place's header. */
  notice: { dismiss: 'Dismiss' },
  /** Before a day band's day, when it's one of these. */
  days: {
    today: 'Today',
    yesterday: 'Yesterday',
    /** A run of days, such as a report's week. */
    span: (start: string, end: string) => `${start} to ${end}`,
  },
}
