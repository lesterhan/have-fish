// What a path picker asks of main: every account and category it can offer.

import type { AccountKind } from '@have-fish/core/account-kind'
import { z } from 'zod'

export const pathInputs = {
  /** Every account and category, for a path picker: its whole path, kind and last use. */
  'path.list': z.strictObject({}),
}

/** An account or category as a path picker offers it. */
export type ListedPath = {
  id: string
  /** Its whole path, root and all: `expenses:food:coffee`. */
  path: string
  kind: AccountKind
  /** UTC ms of the latest live transaction that used it; null if none has. */
  lastUsed: number | null
}

export interface PathValues {
  /** Every live account and category, by path. */
  'path.list': ListedPath[]
}
