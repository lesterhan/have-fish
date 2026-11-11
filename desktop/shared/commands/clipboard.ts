// What copying to the system clipboard asks of main.

import { z } from 'zod'

export const clipboardInputs = {
  /** Text the window put together, onto the system clipboard. It writes nothing to the ledger. */
  'clipboard.copy': z.strictObject({ text: z.string().max(20_000) }),
}

export interface ClipboardValues {
  'clipboard.copy': null
}
