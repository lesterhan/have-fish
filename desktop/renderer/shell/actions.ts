// What the window does when the menu chooses one of its actions.

import type { WindowActionId } from '../../shared/actions'

export type Handlers = Record<WindowActionId, () => void>

/** Runs `id`'s handler. An id the window doesn't carry out is ignored. */
export function runAction(id: string, handlers: Handlers): void {
  if (Object.hasOwn(handlers, id)) handlers[id as WindowActionId]()
}
