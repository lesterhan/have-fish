import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, test, vi } from 'vitest'
import { copy } from '../copy'
import { ACTIONS, type Action, type ActionId } from '../shared/actions'
import { menuTemplate } from './menu'

/** Every item under every menu, and under any menu inside one, flattened. */
function itemsOf(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((menu) =>
    Array.isArray(menu.submenu)
      ? menu.submenu.flatMap((i) => (Array.isArray(i.submenu) ? itemsOf([i]) : [i]))
      : [],
  )
}

const rolesOf = (template: MenuItemConstructorOptions[]) =>
  itemsOf(template).flatMap((i) => (i.role === undefined ? [] : [i.role]))

const UNDO = { undo: { label: 'Undo', enabled: false }, redo: { label: 'Redo', enabled: false } }

const build = (packaged: boolean, mac = false, run = () => {}, undo = UNDO) =>
  menuTemplate({ packaged, mac, run, undo, theme: 'system', density: 'regular' })

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
      ACTIONS.map((a: Action) => [copy.actions.labels[a.id as ActionId], a.accelerator]),
    )
  })

  test('View has the themes as one item, a choice with the current one checked', () => {
    const [, , view] = menuTemplate({
      packaged: true,
      mac: false,
      run: () => {},
      undo: UNDO,
      theme: 'graphite-dark',
      density: 'regular',
    })
    const themes = (view?.submenu as MenuItemConstructorOptions[] | undefined)?.find(
      (i) => i.label === copy.actions.menus.theme,
    )
    const choices = (themes?.submenu ?? []) as MenuItemConstructorOptions[]
    expect(choices.map((c) => [c.label, c.type, c.checked])).toEqual([
      ['Graphite light', 'radio', false],
      ['Graphite dark', 'radio', true],
      ['Follow the system', 'radio', false],
    ])
  })

  test('the menu built with density large: View has Density after Reset zoom and before Theme, Large checked', () => {
    const [, , view] = menuTemplate({
      packaged: true,
      mac: false,
      run: () => {},
      undo: UNDO,
      theme: 'system',
      density: 'large',
    })
    const submenu = (view?.submenu ?? []) as MenuItemConstructorOptions[]
    const labels = submenu.flatMap((i) => (i.type === 'separator' ? [] : [i.label]))
    // The last three: the zoom's last item, then Density, then Theme.
    expect(labels.slice(-3)).toEqual([
      'Actual size',
      copy.actions.menus.density,
      copy.actions.menus.theme,
    ])
    const choices = (submenu.find((i) => i.label === copy.actions.menus.density)?.submenu ??
      []) as MenuItemConstructorOptions[]
    expect(choices.map((c) => [c.label, c.type, c.checked])).toEqual([
      ['Compact', 'radio', false],
      ['Regular', 'radio', false],
      ['Comfortable', 'radio', false],
      ['Large', 'radio', true],
    ])
  })

  test('choosing a density runs its action in the window, which sets it', () => {
    const run = vi.fn()
    const large = itemsOf(build(true, false, run)).find((i) => i.label === 'Large')
    large?.click?.(undefined as never, undefined, undefined as never)
    expect(run).toHaveBeenCalledWith('densityLarge')
  })

  test('choosing a theme runs its action in the window, which sets it', () => {
    const run = vi.fn()
    const dark = itemsOf(build(true, false, run)).find((i) => i.label === 'Graphite dark')
    dark?.click?.(undefined as never, undefined, undefined as never)
    expect(run).toHaveBeenCalledWith('themeGraphiteDark')
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

  test('a key the window takes itself is shown in the menu but not registered there', () => {
    const remove = itemsOf(build(true)).find((i) => i.accelerator === 'Delete')
    expect(remove?.label).toBe('Remove spend')
    expect(remove?.registerAccelerator).toBe(false)
    const refile = itemsOf(build(true)).find((i) => i.accelerator === 'R')
    expect(refile?.label).toBe('Refile spend')
    expect(refile?.registerAccelerator).toBe(false)
    const newSpend = itemsOf(build(true)).find((i) => i.accelerator === 'CmdOrCtrl+N')
    expect(newSpend?.registerAccelerator).toBeUndefined()
  })

  test('on macOS, which registers every accelerator, a key the window takes has none', () => {
    const labels = itemsOf(build(true, true))
      .filter((i) =>
        ['Remove spend', 'Show or hide postings', 'Refile spend'].includes(`${i.label}`),
      )
      .map((i) => [i.label, i.accelerator])
    expect(labels).toEqual([
      ['Remove spend', undefined],
      ['Show or hide postings', undefined],
      ['Refile spend', undefined],
    ])
  })

  test('on macOS, Quit is in the app menu, which comes first', () => {
    const [app, file] = build(true, true)
    expect(app?.label).toBe(copy.app.name)
    expect(rolesOf([app ?? {}])).toEqual(['quit'])
    expect(rolesOf([file ?? {}])).not.toContain('quit')
  })
})
