// The words on the accounts screen: the list, and the pane where an account is added.

import type { AddableKind } from '@have-fish/core/account-kind'

export const accounts = {
  add: 'Add account',
  list: { label: 'Accounts' },
  /** In my words: never asset, liability or equity. */
  kinds: {
    cash: 'Cash',
    bank: 'Bank account',
    card: 'Card',
    loan: 'Loan',
  } satisfies Record<AddableKind, string>,
  /** A starting balance's description, in the ledger and its hledger export. */
  startDescription: 'Starting balance',
  /** A card's or a loan's balance, as what I owe on it; first, so the amounts line up. */
  owed: (amount: string) => `owed ${amount}`,
  /** In place of a currency, for an account that can hold any. */
  anyCurrency: 'Any currency',
  pane: {
    label: 'The account',
    adding: 'Add an account',
    name: 'Name',
    kind: 'Kind',
    currency: 'Currency',
    /** Under Kind, saying what the kind means for my money. */
    hints: {
      cash: 'Notes and coins: money you have.',
      bank: 'Chequing or savings: money you have.',
      card: 'A credit card. Spending on it adds to what you owe.',
      loan: 'Money you owe, like a car loan.',
    } satisfies Record<AddableKind, string>,
    holdsOnly: (currency: string) => `It holds only ${currency}.`,
    holdsAny: 'It can hold any currency.',
    /** Folded away until opened: what I have in it, or owe on a card or a loan. */
    start: {
      have: 'How much is in it today?',
      owe: 'How much do you owe on it today?',
    },
    started: { have: 'Started with', owe: 'Owed at the start' },
    saveStart: 'Save',
    save: 'Add account',
    cancel: 'Cancel',
    back: 'Back to the list',
    nothing: 'Accounts you add show up here.',
  },
}
