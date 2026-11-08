// Every account and category as a path, with when a transaction last used it. A path picker asks
// for all of them once, when it opens, and works out its levels and suggestions from that.

import type { AccountKind } from '@have-fish/core/account-kind'
import type Database from 'better-sqlite3'
import type { ListedPath } from '../../shared/commands'
import { perConnection } from '../db/prepared'

type Row = { id: string; path: string; kind: AccountKind; lastUsed: number | null }

const statements = perConnection((_, db) => ({
  // A tombstoned transaction keeps no postings, so every posting here is a live one.
  paths: db.prepare<[], Row>(
    `SELECT a.id, a.path, a.kind, max(t.originCreatedAt) AS lastUsed
      FROM accounts AS a
      LEFT JOIN postings AS p ON p.accountId = a.id
      LEFT JOIN transactions AS t ON t.id = p.transactionId AND t.deletedAt IS NULL
      WHERE a.deletedAt IS NULL
      GROUP BY a.id
      ORDER BY a.path`,
  ),
}))

/** Every live account and category by path, with when it was last used. */
export const listPaths = (db: Database.Database): ListedPath[] => statements(db).paths.all()
