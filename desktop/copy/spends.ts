// The words on the spends screen: the form, the list and the pane.

export const spends = {
  write: {
    label: 'Write down a spend',
    amount: 'Amount',
    description: 'What for',
    /** The day it happened; today unless I change it. */
    date: 'Date',
    /** Where the money goes: a category, or another account of mine. */
    to: 'To',
    /** What the To field offers, read out. */
    toList: 'Your categories and accounts',
    /** In an empty To field: where a spend with no category goes. */
    unsorted: 'unsorted',
    /** The last option, for a name I haven't used: made when the spend is saved. */
    newCategory: (name: string) => `Create ${name}`,
    badCategory: "That isn't a name a category can have.",
    from: 'From',
    /** What the From field offers, read out: my accounts, then where money comes in from. */
    fromList: 'Your accounts and income',
    /** Beside an income source in From's list. */
    income: 'Income',
    /** From's last option, for a name none of mine has: money coming in from it, made on save. */
    newIncome: (name: string) => `Create income:${name}`,
    badIncome: "That isn't a name an income source can have.",
    /** In an empty From field before there's any account: the wallet the first spend makes. */
    wallet: 'cash',
    submit: 'Write it down',
  },
  list: {
    label: 'Ledger',
    /** The headings over the ledger's columns. */
    columns: { from: 'From', amount: 'Amount', to: 'To', description: 'Description' },
    /** On the selected row's keycap, and beside it: Enter shows its details. */
    enter: 'Enter',
    details: 'details',
  },
  /** In place of a spend's description when it has none. */
  noDescription: '—',
  /** A date field holding something that isn't a day, typed long or the short way. */
  dateUnread: "That isn't a day it can read. Try y, -3, mon or 10-31.",
  /** Read out beside the ● on a spend with a draft. */
  unsaved: 'unsaved changes',
  /** A spend's details, open under its row. */
  card: {
    label: 'The spend',
    description: 'What for',
    amount: 'Amount',
    date: 'Date',
    to: 'To',
    from: 'From',
    save: 'Save',
    close: 'Close',
    /** Close's keycap. */
    esc: 'Esc',
    remove: 'Remove',
    notSimple: "This one moves more than one amount, so it can't be changed here yet.",
  },
}
