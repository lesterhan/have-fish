// The menu's shortcuts, pressed as a person presses them, in the built app. Keys go through
// xdotool: Electron's menu never sees a key that Playwright sends.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, openChip, openSelected, openSpend, PANE, rows, writeDown } from './app'

const LIST = 'ol[aria-label=Ledger]'
const DESCRIPTION = `${PANE} input[name=description]`

const row = (page: Page, text: string) => page.locator(`${LIST} li`, { hasText: text })
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    return `${el?.closest('form')?.getAttribute('aria-label')} ${el?.getAttribute('name')}`
  })

/** Lunch, then Coffee, with Coffee selected. */
async function twoSpends(page: Page) {
  await writeDown(page, '12', 'Lunch')
  await expect.poll(() => rows(page)).toHaveLength(1)
  await writeDown(page, '4.50', 'Coffee')
  await expect.poll(() => rows(page)).toHaveLength(2)
}

describe('shortcuts', () => {
  test('Ctrl+N goes to the amount field from a spend’s details', async () => {
    const { page, press } = await launch(aHome())
    await twoSpends(page)
    await openSelected(page)

    await openChip(page, 'description')
    press('ctrl+n')

    await expect.poll(() => focused(page)).toBe('Write down a spend amount')
  })

  test('Ctrl+N in a narrow window closes the details on its way to the form', async () => {
    const { page, press } = await launch(aHome())
    await page.setViewportSize({ width: 420, height: 700 })
    await twoSpends(page)

    await openSpend(row(page, 'Lunch'))
    press('ctrl+n')

    await expect.poll(() => page.isVisible(PANE)).toBe(false)
    await expect.poll(() => focused(page)).toBe('Write down a spend amount')
  })

  test('Ctrl+= zooms in, Ctrl+- out, and Ctrl+0 back to actual size', async () => {
    const { page, press } = await launch(aHome())
    const ratio = () => page.evaluate(() => devicePixelRatio)
    const start = await ratio()

    press('ctrl+equal')
    await expect.poll(ratio).toBeGreaterThan(start)
    press('ctrl+0')
    await expect.poll(ratio).toBe(start)
    press('ctrl+minus')
    await expect.poll(ratio).toBeLessThan(start)
  })

  // A dev run keeps Reload, so only a packaged build can show it's gone.
  test.runIf(process.env.E2E_APP)('a packaged build has no Reload to lose a change', async () => {
    const { page, press } = await launch(aHome())
    await twoSpends(page)
    await openSelected(page)
    await openChip(page, 'description')

    await page.fill(DESCRIPTION, 'Not yet saved')
    press('ctrl+r')
    press('ctrl+shift+r')
    press('F5')

    // Give a reload the time it would take, then look.
    await page.waitForTimeout(1_000)
    expect(await page.inputValue(DESCRIPTION)).toBe('Not yet saved')
    expect(await page.isVisible('ol[aria-label=Ledger]')).toBe(true)
  })
})
