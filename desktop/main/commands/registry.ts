// Each command the window can run, by name. The names and input schemas are in
// `shared/commands.ts`; this maps each to the service that does it.

import type { Outcome } from '@have-fish/core/outcome'
import type { z } from 'zod'
import type { CommandName, inputs, Values } from '../../shared/commands'
import type { Context } from '../context'
import { editSpend, listTransactions, writeSpend } from '../services/spends'

type Handlers = {
  [N in CommandName]: (ctx: Context, input: z.output<(typeof inputs)[N]>) => Outcome<Values[N]>
}

export const handlers: Handlers = {
  'spend.write': writeSpend,
  'spend.edit': editSpend,
  'transaction.list': (ctx) => ({ ok: true, value: listTransactions(ctx.ledger.db) }),
}
