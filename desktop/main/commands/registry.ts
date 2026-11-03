// Each command the window can run, by name. The names and input schemas are in
// `shared/commands.ts`; this maps each to the service that does it.

import type { Outcome } from '@have-fish/core/outcome'
import type { z } from 'zod'
import type { CommandName, inputs, Values } from '../../shared/commands'
import type { Context } from '../context'
import { addAccount, listAccounts } from '../services/accounts'
import {
  assumedFrom,
  editSpend,
  listTransactions,
  removeSpend,
  saveAllSpends,
  writeSpend,
} from '../services/spends'
import { redoLast, undoLast } from '../undo/steps'

type Handlers = {
  [N in CommandName]: (ctx: Context, input: z.output<(typeof inputs)[N]>) => Outcome<Values[N]>
}

export const handlers: Handlers = {
  'spend.write': writeSpend,
  'spend.assumedFrom': (ctx) => ({ ok: true, value: assumedFrom(ctx) }),
  'spend.edit': editSpend,
  'spend.saveAll': saveAllSpends,
  'spend.remove': removeSpend,
  'transaction.list': (ctx) => ({ ok: true, value: listTransactions(ctx.ledger.db) }),
  'account.add': addAccount,
  'account.list': (ctx) => ({ ok: true, value: listAccounts(ctx.ledger.db) }),
  'ledger.undo': undoLast,
  'ledger.redo': redoLast,
}
