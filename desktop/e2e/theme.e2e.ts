// Choosing a theme from the View menu, the settings file it lives in, and the add form's
// dropdowns painted in it. Keys go through xdotool, so the menu sees them as it would yours.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { ADD_ACCOUNT, ADDING, aHome, goTo, launch, settingsDirIn } from './app'

/** The page's background, as painted. */
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

const dark = (page: Page) => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)

const settingsIn = (home: string) => join(settingsDirIn(home), 'settings.json')

/** A home whose settings.json names `theme`. */
function homeWithTheme(theme: string): string {
  const home = aHome()
  mkdirSync(settingsDirIn(home), { recursive: true })
  writeFileSync(settingsIn(home), JSON.stringify({ theme }))
  return home
}

const settle = (page: Page) => page.waitForTimeout(400)

/** What the page is painted in: background, text. */
const pagePaint = (page: Page) =>
  page.evaluate(() => {
    const { backgroundColor, color } = getComputedStyle(document.body)
    return `${backgroundColor} ${color}`
  })

/** What each option of the add form's `select[name=<name>]` is painted in: background, text. */
const optionPaint = (page: Page, name: string) =>
  page.locator(`${ADDING} select[name=${name}] option`).evaluateAll((options) =>
    options.map((o) => {
      const { backgroundColor, color } = getComputedStyle(o)
      return `${backgroundColor} ${color}`
    }),
  )

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
    const { page } = await launch(homeWithTheme('solarized'))

    expect(await dark(page)).toBe(false)
  })
})

describe("the add form's dropdowns", () => {
  /** The add form open on Accounts, in a home whose settings.json names `theme`. */
  async function addingIn(theme: string): Promise<Page> {
    const { page } = await launch(homeWithTheme(theme))
    await goTo(page, 'Accounts')
    await page.click(ADD_ACCOUNT)
    await page.waitForSelector(`${ADDING} select[name=currency]`)
    return page
  }

  /** Every option of Kind and Currency painted as the page is, and more than one of each. */
  async function expectOptionsPaintedAsPage(page: Page) {
    const paint = await pagePaint(page)
    for (const name of ['kind', 'currency']) {
      const options = await optionPaint(page, name)
      expect(options.length, name).toBeGreaterThan(1)
      expect(options, name).toEqual(options.map(() => paint))
    }
  }

  test('in Graphite dark each Kind and Currency option is painted as the page is', async () => {
    const page = await addingIn('graphite-dark')
    expect(await dark(page)).toBe(true)
    await expectOptionsPaintedAsPage(page)
  })

  test('in Graphite light each Kind and Currency option is painted as the page is', async () => {
    const page = await addingIn('graphite-light')
    expect(await dark(page)).toBe(false)
    await expectOptionsPaintedAsPage(page)
  })
})
