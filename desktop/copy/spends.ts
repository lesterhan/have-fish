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
    /** The accounts the From field offers, read out. */
    fromList: 'Your accounts',
    /** In an empty From field before there's any account: the wallet the first spend makes. */
    wallet: 'cash',
    notMine: "You don't have an account called that.",
    submit: 'Write it down',
  },
  list: { label: 'Spends' },
  /** In place of a spend's description when it has none. */
  noDescription: '—',
  /** Read out beside the ● on a spend with a draft. */
  unsaved: 'unsaved changes',
  pane: {
    label: 'The spend',
    description: 'What for',
    amount: 'Amount',
    date: 'Date',
    to: 'To',
    from: 'From',
    save: 'Save',
    remove: 'Remove',
    back: 'Back to the list',
    nothing: 'Spends you write down show up here.',
    notSimple: "This one moves more than one amount, so it can't be changed here yet.",
  },
}
