// The categories I've put spends in, for the picker to offer.

import { nameOf } from '@have-fish/core/account-path'
import type Database from 'better-sqlite3'
import { and, countDistinct, eq, isNull, ne } from 'drizzle-orm'
import type { ListedCategory } from '../../shared/commands'
import { perConnection } from '../db/prepared'
import { accounts, postings } from '../db/schema'

/** What a spend with no category goes to: never offered, since an empty field means it. */
const UNSORTED_KEY = 'expenses:unsorted'

const statements = perConnection((orm) => ({
  // A tombstoned transaction keeps no postings, so every posting here is a live one.
  used: orm
    .select({
      id: accounts.id,
      path: accounts.path,
      uses: countDistinct(postings.transactionId),
    })
    .from(accounts)
    .innerJoin(postings, eq(postings.accountId, accounts.id))
    .where(
      and(
        isNull(accounts.deletedAt),
        eq(accounts.kind, 'category'),
        ne(accounts.pathKey, UNSORTED_KEY),
      ),
    )
    .groupBy(accounts.id)
    .prepare(),
}))

/** Most used first, then by name without regard to case. A category nothing is in isn't offered. */
export function listCategories(db: Database.Database): ListedCategory[] {
  return statements(db)
    .used.all()
    .map(({ id, path, uses }) => ({ id, name: nameOf(path), uses }))
    .sort((a, b) => b.uses - a.uses || byName.compare(a.name, b.name) || (a.id < b.id ? -1 : 1))
}

const byName = new Intl.Collator('en', { sensitivity: 'accent' })
