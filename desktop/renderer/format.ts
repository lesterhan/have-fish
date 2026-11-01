// How the list writes what a transaction moved.

import type { ListedTransaction } from '../shared/commands'

export const amountsText = (amounts: ListedTransaction['amounts']) =>
  amounts.map(({ amount, currency }) => `${amount} ${currency}`).join(' · ')
