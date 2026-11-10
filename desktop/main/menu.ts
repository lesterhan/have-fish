// The application menu, built from the list of actions. A packaged build has no Reload, which
// would drop unsaved changes, and no developer tools; a dev run keeps both.

import type { MenuItemConstructorOptions } from 'electron'
import { copy } from '../copy'
import { ACTIONS, type Action, type MenuName, type WindowActionId } from '../shared/actions'
import type { Density } from '../shared/density'
import type { ThemeChoice } from '../shared/theme/theme'
import type { UndoItems } from './undo/menu'

type Listed = (typeof ACTIONS)[number]

type Options = {
  packaged: boolean
  mac: boolean
  /** Carries out an action that is the window's to do. */
  run: (id: WindowActionId) => void
  /** What Undo and Redo say now, and whether they can be chosen. */
  undo: UndoItems
  /** The theme chosen now, checked under View, Theme. */
  theme: ThemeChoice
  /** The density chosen now, checked under View, Density. */
  density: Density
}

const MENUS: MenuName[] = ['file', 'edit', 'view']

export function menuTemplate({
  packaged,
  mac,
  run,
  undo,
  theme,
  density,
}: Options): MenuItemConstructorOptions[] {
  // macOS keeps Quit in the app's own menu, which is always the first.
  const inApp = (a: Listed) => mac && 'role' in a && a.role === 'quit'

  const items = (actions: readonly Listed[]): MenuItemConstructorOptions[] =>
    actions.flatMap((a, i) => [
      ...('grouped' in a && i > 0 ? [{ type: 'separator' as const }] : []),
      { ...item(a, run, mac), ...(a.id === 'undo' || a.id === 'redo' ? undo[a.id] : {}) },
    ])

  // The densities are one item under View, opening to a choice between them, as the themes are.
  const densities: MenuItemConstructorOptions[] = [
    { type: 'separator' },
    {
      label: copy.actions.menus.density,
      submenu: ACTIONS.filter(isDensity).map((a) => ({
        ...item(a, run, mac),
        type: 'radio' as const,
        checked: a.density === density,
      })),
    },
  ]

  // The themes are one item under View, opening to a choice between them.
  const themes: MenuItemConstructorOptions[] = [
    { type: 'separator' },
    {
      label: copy.actions.menus.theme,
      submenu: ACTIONS.filter(isTheme).map((a) => ({
        ...item(a, run, mac),
        type: 'radio' as const,
        checked: a.theme === theme,
      })),
    },
  ]

  const menus: MenuItemConstructorOptions[] = MENUS.map((menu) => ({
    label: copy.actions.menus[menu],
    submenu: [
      ...items(ACTIONS.filter((a) => a.menu === menu && !inApp(a) && !isTheme(a) && !isDensity(a))),
      ...(menu === 'view' ? [...densities, ...themes] : []),
      ...(menu === 'view' && !packaged ? DEVELOPER : []),
    ],
  }))

  if (!mac) return menus
  return [{ label: copy.app.name, submenu: items(ACTIONS.filter(inApp)) }, ...menus]
}

const isTheme = (a: Listed): a is Extract<Listed, { theme: ThemeChoice }> => 'theme' in a
const isDensity = (a: Listed): a is Extract<Listed, { density: Density }> => 'density' in a

function item(action: Listed, run: Options['run'], mac: boolean): MenuItemConstructorOptions {
  const label = copy.actions.labels[action.id]
  const { accelerator }: Action = action
  const windowKey = 'windowKey' in action
  // macOS registers every accelerator it shows, and R typed in a field must stay an R there.
  const keys = accelerator === undefined || (windowKey && mac) ? {} : { accelerator }
  if ('role' in action) return { label, ...keys, role: action.role }
  const shownOnly = windowKey ? { registerAccelerator: false } : {}
  return { label, ...keys, ...shownOnly, click: () => run(action.id) }
}

/** For a dev run only. Electron's own words: nobody using the app sees them. */
const DEVELOPER: MenuItemConstructorOptions[] = [
  { type: 'separator' },
  { role: 'reload' },
  { role: 'forceReload' },
  { role: 'toggleDevTools' },
]
