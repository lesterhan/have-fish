import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, test, vi } from 'vitest'
import { copy } from '../copy'
import { ACTIONS } from '../shared/actions'
import { menuTemplate } from './menu'

/** Every item under every menu, flattened. */
function itemsOf(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((menu) => (Array.isArray(menu.submenu) ? menu.submenu : []))
}

const rolesOf = (template: MenuItemConstructorOptions[]) =>
  itemsOf(template).flatMap((i) => (i.role === undefined ? [] : [i.role]))

const UNDO = { undo: { label: 'Undo', enabled: false }, redo: { label: 'Redo', enabled: false } }

const build = (packaged: boolean, mac = false, run = () => {}, undo = UNDO) =>
  menuTemplate({ packaged, mac, run, undo })

const DEVELOPER = ['reload', 'forceReload', 'toggleDevTools']

describe('the menu', () => {
  test('a packaged build has no Reload and no developer tools', () => {
    const roles = rolesOf(build(true))
    for (const role of DEVELOPER) expect(roles).not.toContain(role)
  })

  test('a dev run has them', () => {
    expect(rolesOf(build(false))).toEqual(expect.arrayContaining(DEVELOPER))
  })

  test('File, Edit and View, in their words', () => {
    expect(build(true).map((m) => m.label)).toEqual(['&File', '&Edit', '&View'])
  })

  test('every action is in it once, with its words and its shortcut', () => {
    const items = itemsOf(build(true)).filter((i) => i.type !== 'separator')
    expect(items.map((i) => [i.label, i.accelerator])).toEqual(
      ACTIONS.map((a) => [copy.actions.labels[a.id], a.accelerator]),
    )
  })

  test("choosing a window's action runs it by id", () => {
    const run = vi.fn()
    const newSpend = itemsOf(build(true, false, run)).find((i) => i.accelerator === 'CmdOrCtrl+N')
    newSpend?.click?.(undefined as never, undefined, undefined as never)
    expect(run).toHaveBeenCalledWith('newSpend')
  })

  test('an action Electron does is a role, with no click', () => {
    const copied = itemsOf(build(true)).find((i) => i.role === 'copy')
    expect(copied?.click).toBeUndefined()
  })

  test('Undo and Redo are the window’s, and say what they would do', () => {
    const run = vi.fn()
    const undo = {
      undo: { label: 'Undo write Lunch', enabled: true },
      redo: { label: 'Redo', enabled: false },
    }
    const items = itemsOf(build(true, false, run, undo))
    const [taking, putting] = ['CmdOrCtrl+Z', 'CmdOrCtrl+Shift+Z'].map((key) =>
      items.find((i) => i.accelerator === key),
    )
    expect([taking?.label, taking?.enabled, putting?.label, putting?.enabled]).toEqual([
      'Undo write Lunch',
      true,
      'Redo',
      false,
    ])
    expect(taking?.role).toBeUndefined()
    taking?.click?.(undefined as never, undefined, undefined as never)
    expect(run).toHaveBeenCalledWith('undo')
  })

  test('on macOS, Quit is in the app menu, which comes first', () => {
    const [app, file] = build(true, true)
    expect(app?.label).toBe(copy.app.name)
    expect(rolesOf([app ?? {}])).toEqual(['quit'])
    expect(rolesOf([file ?? {}])).not.toContain('quit')
  })
})
