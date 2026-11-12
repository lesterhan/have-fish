// The spends' commands: writing one down, changing or removing it, and the ledger's list.

import type { spendInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'
import { assumedFrom, editSpend, removeSpend, writeSpend } from './spends'
import {
  daysOfTransactions,
  pageOfTransactions,
  positionOf,
  transactionsWithIds,
} from './transactions'

export const handlers: HandlersFor<keyof typeof spendInputs> = {
  'spend.write': writeSpend,
  'spend.assumedFrom': (ctx) => ({ ok: true, value: assumedFrom(ctx) }),
  'spend.edit': editSpend,
  'spend.remove': removeSpend,
  'transaction.page': (ctx, input) => ({
    ok: true,
    value: pageOfTransactions(ctx.ledger.db, input),
  }),
  'transaction.position': (ctx, { id }) => ({
    ok: true,
    value: { at: positionOf(ctx.ledger.db, id) },
  }),
  'transaction.days': (ctx) => ({ ok: true, value: daysOfTransactions(ctx.ledger.db) }),
  'transaction.get': (ctx, { ids }) => ({
    ok: true,
    value: transactionsWithIds(ctx.ledger.db, ids),
  }),
}
