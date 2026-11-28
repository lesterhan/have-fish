// This computer's switch that looks rates up, driven in the built app: the Places nav, the keys
// through xdotool as the menu's are, and settings.json under a throwaway home.

import { cpSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { copy } from '../copy'
import { aHome, focusedId, goTo, launch, ledgerDirIn, settingsDirIn } from './app'

const NAV = 'nav[aria-label=Places]'

/** The switch on this computer's settings page. */
const theSwitch = (page: Page) => page.getByRole('switch', { name: copy.settings.rates })

/** The place button showing now, by its words: `Settings Ctrl+,`. */
const current = (page: Page) => page.locator(`${NAV} [aria-current=page]`).innerText()

/** What `settings.json` in `home` holds; nothing before anything is written. */
const keptIn = (home: string) => {
  try {
    return JSON.parse(readFileSync(join(settingsDirIn(home), 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
}

/** What the switch is described by, read out: the note under it. */
const descriptionOf = (page: Page) =>
  page.evaluate(() => {
    const id = document.querySelector('input[role=switch]')?.getAttribute('aria-describedby') ?? ''
    return id
      .split(' ')
      .map((one) => document.getElementById(one)?.textContent?.trim() ?? '')
      .join(' ')
      .trim()
  })

/** A fresh app with the switch turned on and quit, its settings.json holding it. */
async function switchedOn(): Promise<string> {
  const home = aHome()
  const { page, quit } = await launch(home)
  await goTo(page, 'Settings')
  await theSwitch(page).click()
  await expect.poll(() => keptIn(home).lookUpRates).toBe(true)
  await quit()
  return home
}

describe('Settings, this computer’s own', () => {
  test('the Places nav has Settings as its fourth button', async () => {
    const { page } = await launch(aHome())
    const named = page.getByRole('button', { name: copy.settings.title, exact: true })

    await expect.poll(() => named.count()).toBe(1)
    await expect.poll(() => page.locator(`${NAV} button`).nth(3).and(named).count()).toBe(1)
  })

  test('that button’s keycap reads Ctrl+,', async () => {
    const { page } = await launch(aHome())

    await expect
      .poll(() => page.locator(`${NAV} button`).nth(3).locator('kbd').innerText())
      .toBe('Ctrl+,')
  })

  test('Ctrl+comma goes to Settings from the ledger', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+comma')

    await expect.poll(() => current(page)).toMatch(/^Settings/)
  })

  test('and the cursor lands on the switch', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+comma')

    await expect.poll(() => focusedId(page)).toBe('settings-rates')
  })

  test('a new home opens with the switch off', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Settings')

    await expect.poll(() => theSwitch(page).isChecked()).toBe(false)
  })

  test('the switch says what a fetch sends, and to whom', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Settings')

    await expect.poll(() => descriptionOf(page)).toBe(copy.reports.fetch.sends)
  })

  test('the switch is on again after a restart', async () => {
    const home = await switchedOn()

    const { page } = await launch(home)
    await goTo(page, 'Settings')

    await expect.poll(() => theSwitch(page).isChecked()).toBe(true)
  })

  test('another computer with the same ledger still asks', async () => {
    const home = await switchedOn()
    const other = aHome()
    cpSync(ledgerDirIn(home), ledgerDirIn(other), { recursive: true })

    const { page } = await launch(other)
    await goTo(page, 'Settings')

    await expect.poll(() => theSwitch(page).isChecked()).toBe(false)
  })
})
