// The clipboard's command: text the window put together, onto the system clipboard.

import type { clipboardInputs } from '../../../shared/commands'
import type { HandlersFor } from '../../commands/handlers'

export const handlers: HandlersFor<keyof typeof clipboardInputs> = {
  'clipboard.copy': (ctx, { text }) => {
    ctx.copy(text)
    return { ok: true, value: null }
  },
}
