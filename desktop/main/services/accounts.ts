// Adding an account on purpose, and the list of the ones I have and owe.

import { randomUUID } from 'node:crypto'
import { ADDABLE_KINDS, type AddableKind } from '@have-fish/core/account-kind'
import { nameOf, pathFor } from '@have-fish/core/account-path'
import type { AccountDoc } from '@have-fish/core/documents'
import { failure, type Outcome } from '@have-fish/core/outcome'
import type Database from 'better-sqlite3'
import { and, inArray, isNull } from 'drizzle-orm'
import type { InputOf, ListedAccount } from '../../shared/commands'
import type { Context } from '../context'
import { perConnection } from '../db/prepared'
import { accounts } from '../db/schema'
import { applyKeeping, record } from '../undo/steps'
import { idOf } from './applied'

/**
 * An account under its kind's root, named as typed, in a batch of its own. A name I already
 * have is refused whatever its kind, since the list shows names without their roots.
 */
export function addAccount(ctx: Context, input: InputOf<'account.add'>): Outcome<{ id: string }> {
  const name = input.name.trim()
  if (name === '') return failure('ACCOUNT_NAME_EMPTY')
  const taken = listAccounts(ctx.ledger.db).find((a) => same(a.name, name))
  if (taken !== undefined) return failure('ACCOUNT_NAME_TAKEN', { name: taken.name })

  const now = ctx.now()
  const account: AccountDoc = {
    type: 'account',
    id: randomUUID(),
    path: pathFor(input.kind, name),
    kind: input.kind,
    currency: input.currency,
    deletedAt: null,
    origin: { source: 'manual', createdAt: now, deviceId: ctx.ledger.meta.deviceId },
  }
  const { applied, changes } = applyKeeping(ctx, [account], now, [account])
  record(ctx, { kind: 'addAccount', name }, changes)
  return idOf(applied, account.id)
}

const statements = perConnection((orm) => ({
  addable: orm
    .select({
      id: accounts.id,
      path: accounts.path,
      kind: accounts.kind,
      currency: accounts.currency,
    })
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), inArray(accounts.kind, [...ADDABLE_KINDS])))
    .prepare(),
}))

/** Every live account I have or owe, by name without regard to case. */
export function listAccounts(db: Database.Database): ListedAccount[] {
  return statements(db)
    .addable.all()
    .map(({ id, path, kind, currency }) => ({
      id,
      name: nameOf(path),
      // The query keeps only these kinds.
      kind: kind as AddableKind,
      currency,
    }))
    .sort((a, b) => byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1))
}

const byName = new Intl.Collator('en', { sensitivity: 'accent' })
/** Without regard to case, as the ledger matches paths. */
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
