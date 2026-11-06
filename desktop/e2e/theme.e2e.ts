// Choosing a theme from the View menu, and the settings file it lives in. Keys go through
// xdotool, so the menu sees them as it would yours.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch } from './app'

/** The page's background, as painted. */
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

const dark = (page: Page) => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)

/** Where main keeps this machine's settings, under `home`. */
const settingsIn = (home: string) => join(home, 'config', 'have-fish-dev', 'settings.json')

const settle = (page: Page) => page.waitForTimeout(400)

describe('the theme', () => {
  test('Graphite dark, chosen from the View menu, repaints the window and is kept', async () => {
    const home = aHome()
    const first = await launch(home)
    expect(await dark(first.page)).toBe(false)
    const light = await background(first.page)

    // View, Theme (its T), then the second choice: the submenu opens with none highlighted.
    first.press('alt+v')
    await settle(first.page)
    first.press('t')
    await settle(first.page)
    for (const key of ['Down', 'Down', 'Return']) first.press(key)

    await expect.poll(() => background(first.page)).not.toBe(light)
    expect(await dark(first.page)).toBe(true)
    expect(JSON.parse(readFileSync(settingsIn(home), 'utf8')).theme).toBe('graphite-dark')

    await first.quit()
    const again = await launch(home)
    expect(await dark(again.page)).toBe(true)
    expect(await background(again.page)).not.toBe(light)
  })

  test('a settings file with a theme it does not know opens, following the system', async () => {
    const home = aHome()
    mkdirSync(join(home, 'config', 'have-fish-dev'), { recursive: true })
    writeFileSync(settingsIn(home), JSON.stringify({ theme: 'solarized' }))

    const { page } = await launch(home)

    expect(await dark(page)).toBe(false)
  })
})
