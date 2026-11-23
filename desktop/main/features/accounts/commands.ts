// The accounts' commands: adding one, its start and its cost, and the Accounts list.

import type { accountInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { addAccount, costStart, listAccounts, startAccount } from './accounts'

export const handlers: HandlersFor<keyof typeof accountInputs> = {
  'account.add': addAccount,
  'account.start': startAccount,
  'account.cost': costStart,
  'account.list': (ctx) => ({ ok: true, value: listAccounts(ctx.ledger.db) }),
}
