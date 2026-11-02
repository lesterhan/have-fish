// Every action the app offers, once. The menu is built from this list and the hints beside
// buttons read it, so a shortcut can't be in one and missing from the other. Each action's words
// are in `copy/actions.ts`, under its id.

/** The top-level menus. On macOS, quitting moves to the app's own menu. */
export type MenuName = 'file' | 'edit' | 'view'

/** Electron's menu roles that the list uses: done by Electron in main, never by the window. */
export type Role =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'quit'

export type Action = {
  readonly id: string
  readonly menu: MenuName
  /** Electron's form: `CmdOrCtrl+N`. */
  readonly accelerator: string
  /** Without one, choosing the action sends its id to the window. */
  readonly role?: Role
  /** A line above it in its menu. */
  readonly grouped?: 'apart'
  /** A second shortcut, on Linux and Windows only, where it's the habit. Not shown in the menu. */
  readonly alternate?: string
  /**
   * The window takes the key itself, where it means this action, and the menu only shows it:
   * Delete removes a spend from the list but must still delete text in a field.
   */
  readonly windowKey?: true
}

export const ACTIONS = [
  { id: 'newSpend', menu: 'file', accelerator: 'CmdOrCtrl+N' },
  { id: 'addAccount', menu: 'file', accelerator: 'CmdOrCtrl+Shift+N' },
  { id: 'saveAll', menu: 'file', accelerator: 'CmdOrCtrl+S' },
  { id: 'quit', menu: 'file', accelerator: 'CmdOrCtrl+Q', role: 'quit', grouped: 'apart' },

  // The window's, not Electron's roles: it decides between a field's typing and the ledger.
  { id: 'undo', menu: 'edit', accelerator: 'CmdOrCtrl+Z' },
  { id: 'redo', menu: 'edit', accelerator: 'CmdOrCtrl+Shift+Z', alternate: 'Ctrl+Y' },
  { id: 'cut', menu: 'edit', accelerator: 'CmdOrCtrl+X', role: 'cut', grouped: 'apart' },
  { id: 'copy', menu: 'edit', accelerator: 'CmdOrCtrl+C', role: 'copy' },
  { id: 'paste', menu: 'edit', accelerator: 'CmdOrCtrl+V', role: 'paste' },
  { id: 'selectAll', menu: 'edit', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
  { id: 'remove', menu: 'edit', accelerator: 'Delete', windowKey: true, grouped: 'apart' },

  // The places down the left, in their order there.
  { id: 'showSpends', menu: 'view', accelerator: 'CmdOrCtrl+1' },
  { id: 'showAccounts', menu: 'view', accelerator: 'CmdOrCtrl+2' },

  // `=`, not Electron's default `Plus`, which needs Shift on most keyboards.
  { id: 'zoomIn', menu: 'view', accelerator: 'CmdOrCtrl+=', role: 'zoomIn', grouped: 'apart' },
  { id: 'zoomOut', menu: 'view', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
  { id: 'resetZoom', menu: 'view', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
] as const satisfies readonly Action[]

export type ActionId = (typeof ACTIONS)[number]['id']

/** The actions the window carries out; Electron does the rest. */
export type WindowActionId = Exclude<(typeof ACTIONS)[number], { role: Role }>['id']

export function actionFor(id: ActionId): Action {
  const action = ACTIONS.find((a) => a.id === id)
  if (action === undefined) throw new Error(`no action ${id}`)
  return action
}

/** Accelerators that more than one action uses, however each is spelled. */
export function sharedAccelerators(actions: readonly Action[]): string[] {
  const seen = new Map<string, number>()
  for (const { accelerator, alternate } of actions) {
    for (const each of alternate === undefined ? [accelerator] : [accelerator, alternate]) {
      const key = normal(each)
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  return [...seen].filter(([, n]) => n > 1).map(([key]) => key)
}

const ALIASES: Record<string, string> = {
  commandorcontrol: 'cmdorctrl',
  control: 'ctrl',
  option: 'alt',
}

/** Lower case, modifiers sorted, the key last: `Shift+CmdOrCtrl+Z` is `CmdOrCtrl+Shift+Z`. */
function normal(accelerator: string): string {
  const parts = accelerator.toLowerCase().split(/\+(?!$)/)
  const key = parts.pop() ?? ''
  const modifiers = parts.map((p) => ALIASES[p] ?? p).sort()
  return [...modifiers, key].join('+')
}
