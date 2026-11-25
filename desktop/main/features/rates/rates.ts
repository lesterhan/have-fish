// Writing a rate I typed for a day, into the home currency.

import type { RateDoc } from '@have-fish/core/documents'
import type { Outcome } from '@have-fish/core/outcome'
import type { InputOf } from '../../../shared/commands'
import { HOME_CURRENCY } from '../../../shared/currency'
import { idOf } from '../../commands/applied'
import type { Context } from '../../context'
import { rateId } from '../../ledger/rate-id'
import { getDocument } from '../../ledger/store'
import { applyKeeping, record } from '../../undo/steps'

/**
 * The day's rate from a currency I typed, as a new version of the day's document when there is
 * one. It keeps the stored origin, a tombstone's too: apply refuses a write that changes one.
 */
export function writeRate(ctx: Context, input: InputOf<'rate.write'>): Outcome<{ id: string }> {
  const { db } = ctx.ledger
  const now = ctx.now()
  const fields = { date: input.date, from: input.currency, to: HOME_CURRENCY }
  const made = { source: 'manual', createdAt: now, deviceId: ctx.ledger.meta.deviceId } as const
  const id = rateId({ ...fields, origin: made })
  const stored = getDocument(db, 'rate', id)
  const origin = stored?.doc.origin ?? made
  const doc: RateDoc = {
    type: 'rate',
    id,
    ...fields,
    rate: input.rate.trim(),
    published: null,
    deletedAt: null,
    origin,
  }
  const { applied, changes } = applyKeeping(ctx, [doc], now, [doc])
  record(ctx, { action: 'writeRate', currency: input.currency, date: input.date }, changes)
  return idOf(applied, doc.id)
}
