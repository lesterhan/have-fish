// The application menu, built from the list of actions. A packaged build has no Reload, which
// would drop unsaved changes, and no developer tools; a dev run keeps both.

import type { MenuItemConstructorOptions } from 'electron'
import { copy } from '../copy'
import { ACTIONS, type MenuName, type WindowActionId } from '../shared/actions'
import type { UndoItems } from './undo/menu'

type Listed = (typeof ACTIONS)[number]

type Options = {
  packaged: boolean
  mac: boolean
  /** Carries out an action that is the window's to do. */
  run: (id: WindowActionId) => void
  /** What Undo and Redo say now, and whether they can be chosen. */
  undo: UndoItems
}

const MENUS: MenuName[] = ['file', 'edit', 'view']

export function menuTemplate({ packaged, mac, run, undo }: Options): MenuItemConstructorOptions[] {
  // macOS keeps Quit in the app's own menu, which is always the first.
  const inApp = (a: Listed) => mac && 'role' in a && a.role === 'quit'

  const items = (actions: readonly Listed[]): MenuItemConstructorOptions[] =>
    actions.flatMap((a, i) => [
      ...('grouped' in a && i > 0 ? [{ type: 'separator' as const }] : []),
      { ...item(a, run), ...(a.id === 'undo' || a.id === 'redo' ? undo[a.id] : {}) },
    ])

  const menus: MenuItemConstructorOptions[] = MENUS.map((menu) => ({
    label: copy.actions.menus[menu],
    submenu: [
      ...items(ACTIONS.filter((a) => a.menu === menu && !inApp(a))),
      ...(menu === 'view' && !packaged ? DEVELOPER : []),
    ],
  }))

  if (!mac) return menus
  return [{ label: copy.app.name, submenu: items(ACTIONS.filter(inApp)) }, ...menus]
}

function item(action: Listed, run: Options['run']): MenuItemConstructorOptions {
  const label = copy.actions.labels[action.id]
  const { accelerator } = action
  if ('role' in action) return { label, accelerator, role: action.role }
  const shownOnly = 'windowKey' in action ? { registerAccelerator: false } : {}
  return { label, accelerator, ...shownOnly, click: () => run(action.id) }
}

/** For a dev run only. Electron's own words: nobody using the app sees them. */
const DEVELOPER: MenuItemConstructorOptions[] = [
  { type: 'separator' },
  { role: 'reload' },
  { role: 'forceReload' },
  { role: 'toggleDevTools' },
]
