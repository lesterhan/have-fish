// How the list writes what a transaction moved, and the day it is.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { ListedTransaction } from '../shared/commands'

export const amountsText = (amounts: ListedTransaction['amounts']) =>
  amounts.map(({ amount, currency }) => `${amount} ${currency}`).join(' · ')

/** Today's date, `YYYY-MM-DD`, where this machine is: what a new spend's date starts at. */
export const todayIn = (
  now = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) => calendarDateAt(now, timeZone)
