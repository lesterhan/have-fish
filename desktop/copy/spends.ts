// The words on the spends screen: the form, the list and the pane.

export const spends = {
  write: {
    label: 'Write down a spend',
    amount: 'Amount',
    description: 'What for',
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
    save: 'Save',
    back: 'Back to the list',
    nothing: 'Spends you write down show up here.',
    notSimple: "This one moves more than one amount, so it can't be changed here yet.",
  },
}
