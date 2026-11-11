// The accounts' commands: adding one, giving it a starting balance, and the Accounts list.

import type { accountInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { addAccount, listAccounts, startAccount } from './accounts'

export const handlers: HandlersFor<keyof typeof accountInputs> = {
  'account.add': addAccount,
  'account.start': startAccount,
  'account.list': (ctx) => ({ ok: true, value: listAccounts(ctx.ledger.db) }),
}
