// What each command is: whether it writes to the ledger, and what its answer reads. The window
// loads this at run time, so it imports only types and never zod.

import type { DocumentTypeName } from '@have-fish/core/documents'
import type { CommandName } from './commands'

export type Traits = {
  /** Whether it writes documents to the ledger; settings and the clipboard aren't the ledger. */
  writes: boolean
  /**
   * The types of document whose change can change its answer: never fewer than its SQL reads, or
   * than a write moves outside the ledger, as a spend moves the account used last.
   */
  reads: readonly DocumentTypeName[]
}

/** Every type of document: core's `DOCUMENT_TYPES` is a value, so this can't import it. */
export const ALL_TYPES: readonly DocumentTypeName[] = ['transaction', 'account', 'rate']

export type TraitsTable = { [N in CommandName]: Traits }

export const traits: TraitsTable = {
  'spend.write': { writes: true, reads: ALL_TYPES },
  'spend.edit': { writes: true, reads: ALL_TYPES },
  'spend.remove': { writes: true, reads: ALL_TYPES },
  // A spend from another account moves the machine's last account.
  'spend.assumedFrom': { writes: false, reads: ALL_TYPES },
  'transaction.page': { writes: false, reads: ALL_TYPES },
  'transaction.position': { writes: false, reads: ALL_TYPES },
  'transaction.days': { writes: false, reads: ALL_TYPES },
  'transaction.get': { writes: false, reads: ALL_TYPES },

  'account.add': { writes: true, reads: ALL_TYPES },
  'account.start': { writes: true, reads: ALL_TYPES },
  'account.cost': { writes: true, reads: ALL_TYPES },
  'account.list': { writes: false, reads: ALL_TYPES },

  'path.list': { writes: false, reads: ALL_TYPES },

  // A category's name is an account's path.
  'report.spending': { writes: false, reads: ALL_TYPES },

  'rate.write': { writes: true, reads: ALL_TYPES },
  'rate.writeAll': { writes: true, reads: ALL_TYPES },

  'ledger.undo': { writes: true, reads: ALL_TYPES },
  'ledger.redo': { writes: true, reads: ALL_TYPES },
  // The undo history, which any local write changes.
  'ledger.steps': { writes: false, reads: ALL_TYPES },

  'settings.theme.set': { writes: false, reads: [] },
  'settings.density.get': { writes: false, reads: [] },
  'settings.density.set': { writes: false, reads: [] },

  'clipboard.copy': { writes: false, reads: [] },
}
