// Writing the rates I typed for a day, one or several as one step, into the home currency.

import type { RateDoc } from '@have-fish/core/documents'
import type { Outcome } from '@have-fish/core/outcome'
import type { InputOf } from '../../../shared/commands'
import { HOME_CURRENCY } from '../../../shared/currency'
import { idOf, outcomeOf } from '../../commands/applied'
import type { Context } from '../../context'
import { rateId } from '../../ledger/rate-id'
import { getDocument } from '../../ledger/store'
import { applyKeeping, record } from '../../undo/steps'

/** A rate document I typed, a new version of the day's when there is one: its origin kept. */
function rateDocOf(ctx: Context, line: InputOf<'rate.write'>, now: number): RateDoc {
  const { db } = ctx.ledger
  const fields = { date: line.date, from: line.currency, to: HOME_CURRENCY }
  const made = { source: 'manual', createdAt: now, deviceId: ctx.ledger.meta.deviceId } as const
  const id = rateId({ ...fields, origin: made })
  const stored = getDocument(db, 'rate', id)
  const origin = stored?.doc.origin ?? made
  return {
    type: 'rate',
    id,
    ...fields,
    rate: line.rate.trim(),
    published: null,
    deletedAt: null,
    origin,
  }
}

/**
 * The day's rate from a currency I typed, as a new version of the day's document when there is
 * one. It keeps the stored origin, a tombstone's too: apply refuses a write that changes one.
 */
export function writeRate(ctx: Context, input: InputOf<'rate.write'>): Outcome<{ id: string }> {
  const now = ctx.now()
  const doc = rateDocOf(ctx, input, now)
  const { applied, changes } = applyKeeping(ctx, [doc], now, [doc])
  record(ctx, { action: 'writeRate', currency: input.currency, date: input.date }, changes)
  return idOf(applied, doc.id)
}

/** The rates I typed, as one step: written whole or refused whole. */
export function writeAllRates(
  ctx: Context,
  input: InputOf<'rate.writeAll'>,
): Outcome<{ ids: string[] }> {
  const now = ctx.now()
  const docs = input.rates.map((one) => rateDocOf(ctx, one, now))
  const { applied, changes } = applyKeeping(ctx, docs, now, docs)
  record(ctx, { action: 'writeAllRates', count: docs.length }, changes)
  return outcomeOf(applied, { ids: docs.map((doc) => doc.id) })
}
