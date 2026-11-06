// The menu's shortcuts, pressed as a person presses them, in the built app. Keys go through
// xdotool: Electron's menu never sees a key that Playwright sends.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, PANE, rows, shownDay, unsavedInPane, WRITE, writeDown } from './app'

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

const LIST = 'ol[aria-label=Ledger]'
const AMOUNT = `${PANE} input[name=amount]`
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
  test('Ctrl+N goes to the amount field from the pane', async () => {
    const { page, press } = await launch(aHome())
    await twoSpends(page)

    await page.focus(DESCRIPTION)
    press('ctrl+n')

    await expect.poll(() => focused(page)).toBe('Write down a spend amount')
  })

  test('Ctrl+N in a narrow window takes the pane off the form', async () => {
    const { page, press } = await launch(aHome())
    await page.setViewportSize({ width: 420, height: 700 })
    await twoSpends(page)

    await row(page, 'Lunch').click()
    await expect.poll(() => page.isVisible(PANE)).toBe(true)
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

  test('Ctrl+S saves the changes on every spend, and clears every ●', async () => {
    const { page, press } = await launch(aHome())
    await twoSpends(page)

    await page.fill(AMOUNT, '5')
    await row(page, 'Lunch').click()
    await page.fill(DESCRIPTION, 'Lunch with Sam')
    await expect.poll(async () => (await rows(page)).filter((r) => r.includes('●'))).toHaveLength(2)

    press('ctrl+s')

    await expect
      .poll(() => rows(page))
      .toEqual([
        `${shownDay(today())} | Coffee | 5.00`,
        `${shownDay(today())} | Lunch with Sam | 12.00`,
      ])
    expect(await unsavedInPane(page)).toBe(0)
  })

  test('Ctrl+S: a change that is refused keeps its ●, says why, and holds back no other', async () => {
    const { page, press } = await launch(aHome())
    await twoSpends(page)

    await page.fill(AMOUNT, 'lots')
    await row(page, 'Lunch').click()
    await page.fill(AMOUNT, '15')
    press('ctrl+s')

    await expect
      .poll(() => rows(page))
      .toEqual([
        `${shownDay(today())} | Coffee | 4.50 | ●unsaved changes`,
        `${shownDay(today())} | Lunch | 15.00`,
      ])

    await row(page, 'Coffee').click()
    expect(await page.inputValue(AMOUNT)).toBe('lots')
    expect(await page.textContent(`${PANE} [role=alert]`)).toBe(
      "That isn't an amount. Type a number, like 4.50.",
    )
  })

  // A dev run keeps Reload, so only a packaged build can show it's gone.
  test.runIf(process.env.E2E_APP)('a packaged build has no Reload to lose a change', async () => {
    const { page, press } = await launch(aHome())
    await twoSpends(page)

    await page.fill(DESCRIPTION, 'Not yet saved')
    press('ctrl+r')
    press('ctrl+shift+r')
    press('F5')

    // Give a reload the time it would take, then look.
    await page.waitForTimeout(1_000)
    expect(await page.inputValue(DESCRIPTION)).toBe('Not yet saved')
    expect(await page.isVisible(`${WRITE} input[name=amount]`)).toBe(true)
  })
})
