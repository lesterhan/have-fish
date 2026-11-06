// Removing a spend, and taking the removal back: Entry-6's acceptance, with real keys.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  aHome,
  launch,
  openSelected,
  openSpend,
  PANE,
  rows,
  shownDay,
  spendCells,
  WRITE,
  writeDown,
} from './app'

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

const LIST = 'ol[aria-label=Ledger]'
const P_AMOUNT = `${PANE} input[name=amount]`
const P_DESCRIPTION = `${PANE} input[name=description]`
const REMOVE = `${PANE} >> role=button[name="Remove"s]`

const row = (page: Page, text: string) => page.locator(`${LIST} li`, { hasText: text })
const selected = (page: Page) =>
  spendCells(page.locator(`${LIST} li[aria-selected=true]`)).then((rows) => rows.map(([, d]) => d))
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    const where = el?.closest('form, section, ol')?.getAttribute('aria-label')
    return `${where} ${el?.getAttribute('name') ?? el?.tagName}`
  })

/** Lunch, Coffee and Tea, newest first in the list. */
async function threeSpends(page: Page) {
  for (const [amount, what] of [
    ['12', 'Lunch'],
    ['4.50', 'Coffee'],
    ['3', 'Tea'],
  ] as const) {
    const before = (await rows(page)).length
    await writeDown(page, amount, what)
    await expect.poll(() => rows(page)).toHaveLength(before + 1)
  }
}

describe('removing a spend', () => {
  test('Delete on the list removes the selected spend; the next row is selected', async () => {
    const { page, press } = await launch(aHome())
    await threeSpends(page)

    await row(page, 'Coffee').click()
    press('Delete')

    await expect
      .poll(() => rows(page))
      .toEqual([`${shownDay(today())} | Tea | 3.00`, `${shownDay(today())} | Lunch | 12.00`])
    expect(await selected(page)).toEqual(['Lunch'])
    expect(await focused(page)).toBe('Ledger OL')
  })

  test('Remove in its details does the same, with no “are you sure?”', async () => {
    const { page } = await launch(aHome())
    await threeSpends(page)

    await openSpend(row(page, 'Lunch'))
    await page.click(REMOVE)

    await expect
      .poll(() => rows(page))
      .toEqual([`${shownDay(today())} | Tea | 3.00`, `${shownDay(today())} | Coffee | 4.50`])
    expect(await selected(page)).toEqual(['Coffee'])
  })

  test('Ctrl+Z brings it back exactly as it was, selected', async () => {
    const { page, press } = await launch(aHome())
    await threeSpends(page)
    const before = await rows(page)

    await row(page, 'Coffee').click()
    press('Delete')
    await expect.poll(() => rows(page)).toHaveLength(2)

    press('ctrl+z')
    await expect.poll(() => rows(page)).toEqual(before)
    await expect.poll(() => selected(page)).toEqual(['Coffee'])
    await openSelected(page)
    expect(await page.inputValue(P_AMOUNT)).toBe('4.50')
  })

  test('removing a spend with a draft drops the draft; undo brings back what was saved', async () => {
    const { page, press } = await launch(aHome())
    await threeSpends(page)

    await openSpend(row(page, 'Coffee'))
    await page.fill(P_DESCRIPTION, 'Coffee, not saved')
    await expect.poll(async () => (await rows(page)).some((r) => r.includes('●'))).toBe(true)
    await page.click(REMOVE)
    await expect.poll(() => rows(page)).toHaveLength(2)

    await row(page, 'Tea').click()
    press('ctrl+z')
    await expect.poll(() => rows(page)).toHaveLength(3)
    expect((await rows(page)).filter((r) => r.includes('●'))).toEqual([])
    await expect.poll(() => selected(page)).toEqual(['Coffee'])
    await openSelected(page)
    expect(await page.inputValue(P_DESCRIPTION)).toBe('Coffee')
  })

  test('Delete in a text field deletes text, never a spend', async () => {
    const { page, press } = await launch(aHome())
    await threeSpends(page)
    await openSelected(page)

    await page.focus(P_DESCRIPTION)
    await page.keyboard.press('Home')
    press('Delete')
    await expect.poll(() => page.inputValue(P_DESCRIPTION)).toBe('ea')

    await page.focus(`${WRITE} input[name=amount]`)
    press('Delete')
    await page.waitForTimeout(400)
    expect(await rows(page)).toHaveLength(3)
  })

  test('removing the last spend leaves the cursor in the amount field', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await openSelected(page)
    await page.click(REMOVE)
    await expect.poll(() => rows(page)).toEqual([])
    expect(await focused(page)).toBe('Write down a spend amount')
  })
})
