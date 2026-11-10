// The words on the spends screen: the form, the list and the pane.

/** A line with one part set in the code face: where an import's file name goes. */
export type OriginPart = { text: string; code?: boolean }

export const spends = {
  /** The line that writes a spend, in the ledger: its parts, examples and refusals. */
  composer: {
    new: '+ New',
    /** The line's own pill, which isn't the header's button. */
    pill: 'New',
    done: 'Done',
    esc: 'Esc',
    tab: 'Tab',
    /** The parts, in the order they read, until each is filled. */
    parts: {
      from: 'from',
      date: 'date',
      amount: 'amount',
      description: 'description',
      to: 'to',
    },
    /** The first time, with no accounts yet: examples in the format to type. */
    examples: {
      from: 'assets:wallet',
      date: 'today',
      amount: '4.50',
      description: 'coffee',
      to: 'expenses:food:coffee',
    },
    /** What the date list is called, read out. */
    dateList: 'Days it can read',
    /** Two words of why a part was refused; the input is underlined red beside them. */
    refused: {
      amount: 'not an amount',
      positive: 'not positive',
      date: 'not a day',
      from: 'not an income',
      to: 'not a category',
      account: 'not an account',
      same: 'same account',
      precise: 'too precise',
      form: 'not saved',
    },
  },
  /** The batch under the line: the lines this opening of the line has written. */
  batch: {
    /** What the batch is called, read out. */
    label: 'Just written',
    /** The mark on each line of it, at the end of its description. */
    tick: '✓',
    saved: 'Saved',
  },
  write: {
    /** The line's label, read out. */
    label: 'Write down a spend',
    /** What the To part offers, read out. */
    toList: 'Your categories and accounts',
    /** In a spend with no category: where it went. */
    unsorted: 'unsorted',
    /** The last option, for a name I haven't used: made when the spend is saved. */
    newCategory: (name: string) => `Create ${name}`,
    badCategory: "That isn't a name a category can have.",
    /** What the From part offers, read out: my accounts, then where money comes in from. */
    fromList: 'Your accounts and income',
    /** From's last option, for a name none of mine has: money coming in from it, made on save. */
    newIncome: (name: string) => `Create income:${name}`,
    badIncome: "That isn't a name an income source can have.",
  },
  list: {
    label: 'Ledger',
    /** The headings over the ledger's columns. */
    columns: { from: 'From', amount: 'Amount', to: 'To', description: 'Description' },
    /** On the selected row's keycap, and beside it: Enter shows its details, R refiles it. */
    enter: 'Enter',
    details: 'details',
    refile: 'refile',
  },
  /** In a path picker: how long ago a path was used, and the key that opens a part of it. */
  picker: {
    used: {
      today: 'used today',
      yesterday: 'used yesterday',
      days: (days: number) => `used ${days} days ago`,
      now: 'now',
    },
    open: (name: string) => `Open ${name}`,
  },
  /** In place of a spend's description when it has none. */
  noDescription: '—',
  /** A date field holding something that isn't a day, typed long or the short way. */
  dateUnread: "That isn't a day it can read. Try y, -3, mon or 10-31.",
  /** A spend's details, open under its row, as a sentence of chips. */
  card: {
    label: 'The spend',
    /** The plain words between the chips. */
    sentence: {
      paid: 'Paid',
      at: 'at',
      from: 'from',
      on: 'on',
      into: 'into',
      with: 'with',
      and: 'and',
    },
    /** What each chip is called, read out. */
    chip: {
      amount: 'Amount',
      description: 'What for',
      from: 'From',
      date: 'Date',
      to: 'To',
    },
    close: 'Close',
    /** Close's keycap. */
    esc: 'Esc',
    remove: 'Remove',
    notSimple: "This one moves more than one amount, so it can't be changed here yet.",
    /** Where it came from, when, and on which computer. */
    origin: {
      manual: (when: string, place: string): OriginPart[] => [
        { text: `Written by hand · ${when} · ${place}` },
      ],
      system: (when: string, place: string): OriginPart[] => [
        { text: `Made by have-fish · ${when} · ${place}` },
      ],
      imported: (file: string, line: number, when: string, place: string): OriginPart[] => [
        { text: 'Imported from ' },
        { text: file, code: true },
        { text: `, line ${line} · ${when} · ${place}` },
      ],
      here: 'this computer',
      elsewhere: 'another computer',
    },
    /** The postings block's name. */
    postings: 'Postings',
    copy: 'Copy',
    /** Copy's word just after it is pressed. */
    copied: 'Copied',
    /** Said for each currency that balances, and each that doesn't. */
    balanced: (currency: string) => `${currency} balances`,
    unbalanced: (currency: string) => `${currency} doesn't balance`,
    /** What a posting calls an account that isn't in this ledger yet. */
    missingAccount: 'an account not here yet',
  },
}
