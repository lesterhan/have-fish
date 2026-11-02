// Every action the app offers, once. The menu is built from this list and the hints beside
// buttons read it, so a shortcut can't be in one and missing from the other. Each action's words
// are in `copy/actions.ts`, under its id.

/** The top-level menus. On macOS, quitting moves to the app's own menu. */
export type MenuName = 'file' | 'edit' | 'view'

/** Electron's menu roles that the list uses: done by Electron in main, never by the window. */
export type Role =
  | 'undo'
  | 'redo'
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
}

export const ACTIONS = [
  { id: 'newSpend', menu: 'file', accelerator: 'CmdOrCtrl+N' },
  { id: 'saveAll', menu: 'file', accelerator: 'CmdOrCtrl+S' },
  { id: 'quit', menu: 'file', accelerator: 'CmdOrCtrl+Q', role: 'quit', grouped: 'apart' },

  { id: 'undo', menu: 'edit', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
  { id: 'redo', menu: 'edit', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
  { id: 'cut', menu: 'edit', accelerator: 'CmdOrCtrl+X', role: 'cut', grouped: 'apart' },
  { id: 'copy', menu: 'edit', accelerator: 'CmdOrCtrl+C', role: 'copy' },
  { id: 'paste', menu: 'edit', accelerator: 'CmdOrCtrl+V', role: 'paste' },
  { id: 'selectAll', menu: 'edit', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },

  // `=`, not Electron's default `Plus`, which needs Shift on most keyboards.
  { id: 'zoomIn', menu: 'view', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
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
  for (const { accelerator } of actions) {
    const key = normal(accelerator)
    seen.set(key, (seen.get(key) ?? 0) + 1)
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
