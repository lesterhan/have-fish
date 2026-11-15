// Each place's component, which App mounts in PLACES' order: a new place is a line here.

import Accounts from '../places/accounts/Accounts.svelte'
import Reports from '../places/reports/Reports.svelte'
import Spends from '../places/spends/Spends.svelte'
import type { Place } from './places'

export const VIEWS = { ledger: Spends, accounts: Accounts, reports: Reports } satisfies Record<
  Place,
  unknown
>
