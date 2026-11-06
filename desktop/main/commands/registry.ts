// Each command the window can run, by name. The names and input schemas are in
// `shared/commands.ts`; this maps each to the service that does it.

import type { Outcome } from '@have-fish/core/outcome'
import type { z } from 'zod'
import type { CommandName, inputs, Values } from '../../shared/commands'
import type { Context } from '../context'
import { addAccount, listAccounts, startAccount } from '../services/accounts'
import { listCategories, listIncome } from '../services/categories'
import { spendingIn } from '../services/reports'
import { setTheme } from '../services/settings'
import { assumedFrom, editSpend, removeSpend, saveAllSpends, writeSpend } from '../services/spends'
import { pageOfTransactions, positionOf, transactionsWithIds } from '../services/transactions'
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
  'transaction.page': (ctx, input) => ({
    ok: true,
    value: pageOfTransactions(ctx.ledger.db, input),
  }),
  'transaction.position': (ctx, { id }) => ({
    ok: true,
    value: { at: positionOf(ctx.ledger.db, id) },
  }),
  'transaction.get': (ctx, { ids }) => ({
    ok: true,
    value: transactionsWithIds(ctx.ledger.db, ids),
  }),
  'account.add': addAccount,
  'account.start': startAccount,
  'category.list': (ctx) => ({ ok: true, value: listCategories(ctx.ledger.db) }),
  'income.list': (ctx) => ({ ok: true, value: listIncome(ctx.ledger.db) }),
  'account.list': (ctx) => ({ ok: true, value: listAccounts(ctx.ledger.db) }),
  'report.spending': (ctx, input) => spendingIn(ctx.ledger.db, input),
  'ledger.undo': undoLast,
  'ledger.redo': redoLast,
  'settings.theme.set': setTheme,
}
