// The IPC channel names. Their own file, with no imports, so the preload bundles nothing else.

/** The window runs a command: `invoke(COMMAND, name, input)`. */
export const COMMAND = 'command'

/** Main says which documents a batch changed, after it commits. */
export const CHANGED = 'ledger:changed'

/** Main asks the window to carry out an action from the menu: `send(ACTION, id)`. */
export const ACTION = 'action:run'
