// What each command is: whether it writes to the ledger, and what its answer reads. The window
// loads this at run time, so it imports only types and never zod.

import type { DocumentTypeName } from '@have-fish/core/documents'
import type { CommandName } from './commands'

export type Traits = {
  /** Whether it writes documents to the ledger; settings and the clipboard aren't the ledger. */
  writes: boolean
  /**
   * The kinds of document whose change can change its answer: never fewer than its SQL reads, or
   * than a write moves outside the ledger, as a spend moves the account used last.
   */
  reads: readonly DocumentTypeName[]
}

/** Every kind of document: core's `DOCUMENT_TYPES` is a value, so this can't import it. */
export const ALL_KINDS: readonly DocumentTypeName[] = ['transaction', 'account']

export type TraitsTable = { [N in CommandName]: Traits }

export const traits: TraitsTable = {
  'spend.write': { writes: true, reads: ALL_KINDS },
  'spend.edit': { writes: true, reads: ALL_KINDS },
  'spend.remove': { writes: true, reads: ALL_KINDS },
  // A spend from another account moves the machine's last account.
  'spend.assumedFrom': { writes: false, reads: ALL_KINDS },
  'transaction.page': { writes: false, reads: ALL_KINDS },
  'transaction.position': { writes: false, reads: ALL_KINDS },
  'transaction.days': { writes: false, reads: ALL_KINDS },
  'transaction.get': { writes: false, reads: ALL_KINDS },

  'account.add': { writes: true, reads: ALL_KINDS },
  'account.start': { writes: true, reads: ALL_KINDS },
  'account.list': { writes: false, reads: ALL_KINDS },

  'path.list': { writes: false, reads: ALL_KINDS },

  // A category's name is an account's path.
  'report.spending': { writes: false, reads: ALL_KINDS },

  'ledger.undo': { writes: true, reads: ALL_KINDS },
  'ledger.redo': { writes: true, reads: ALL_KINDS },
  // The undo history, which any local write changes.
  'ledger.steps': { writes: false, reads: ALL_KINDS },

  'settings.theme.set': { writes: false, reads: [] },
  'settings.density.get': { writes: false, reads: [] },
  'settings.density.set': { writes: false, reads: [] },

  'clipboard.copy': { writes: false, reads: [] },
}
