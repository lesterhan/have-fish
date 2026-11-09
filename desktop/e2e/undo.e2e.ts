// Undo and Redo, pressed as a person presses them: a field's own typing first, else the ledger.
// Keys go through xdotool, so the window and the menu see them as they would yours.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  aHome,
  launch,
  openChip,
  openComposer,
  openSelected,
  PANE,
  rows,
  shownDay,
  WRITE,
  writeDown,
} from './app'

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

const LIST = 'ol[aria-label=Ledger]'
const W_AMOUNT = `${WRITE} input[name=amount]`
const W_DESCRIPTION = `${WRITE} input[name=description]`
const P_DESCRIPTION = `${PANE} input[name=description]`

const row = (page: Page, text: string) => page.locator(`${LIST} li`, { hasText: text })
const selected = (page: Page) =>
  page.locator(`${LIST} li[aria-selected=true]`).evaluateAll((li) => li.map((l) => l.textContent))
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    const where = el?.closest('form, section, ol')?.getAttribute('aria-label')
    return `${where} ${el?.getAttribute('name') ?? el?.tagName}`
  })
/** Long enough for a key that should change nothing to have changed something. */
const settle = (page: Page) => page.waitForTimeout(400)

describe('undo and redo', () => {
  test('Ctrl+Z takes back a spend just written; Ctrl+Shift+Z puts it back, selected', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    press('ctrl+z')
    await expect.poll(() => rows(page)).toEqual([])
    expect(await focused(page)).toBe('Ledger OL')

    press('ctrl+shift+z')
    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])
    await expect.poll(() => selected(page)).toEqual([expect.stringContaining('Coffee')])
  })

  test('Ctrl+Y redoes too, off macOS', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    press('ctrl+z')
    await expect.poll(() => rows(page)).toEqual([])

    press('ctrl+y')
    await expect.poll(() => rows(page)).toHaveLength(1)
  })

  test('in a field you have only entered, Ctrl+Z is the ledger’s, and other fields keep their typing', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await openComposer(page)
    await page.focus(W_AMOUNT)
    await page.keyboard.type('7')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Tea')
    await page.focus(W_AMOUNT)
    press('ctrl+z')

    await expect.poll(() => rows(page)).toEqual([])
    expect(await page.inputValue(W_DESCRIPTION)).toBe('Tea')
    expect(await page.inputValue(W_AMOUNT)).toBe('7')
    expect(await focused(page)).toBe('Write down a spend amount')
  })

  test('with your typing in the field, Ctrl+Z takes back the typing, not the ledger', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await openComposer(page)
    await page.focus(W_DESCRIPTION)
    await page.keyboard.type('Tea')
    press('ctrl+z')

    await expect.poll(() => page.inputValue(W_DESCRIPTION)).toBe('')
    await settle(page)
    expect(await rows(page)).toHaveLength(1)
  })

  test('with a row focused, Ctrl+Z takes back the last change, and focus stays on the list', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(2)

    await row(page, 'Lunch').click()
    press('ctrl+z')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Lunch | 12.00`])
    expect(await focused(page)).toBe('Ledger OL')
  })

  test('a saved edit is taken back as the edit, not as typing in its details', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await openSelected(page)
    await openChip(page, 'description')

    await page.focus(P_DESCRIPTION)
    await page.keyboard.press('End')
    await page.keyboard.type(' cake')
    await page.keyboard.press('Enter')
    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Coffee cake | 4.50`])

    press('ctrl+z')
    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])
    await openChip(page, 'description')
    expect(await page.inputValue(P_DESCRIPTION)).toBe('Coffee')
  })

  test('choosing Undo from the Edit menu does what Ctrl+Z does', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)

    // Alt+E opens Edit with its first item, Undo, highlighted.
    press('alt+e')
    await settle(page)
    press('Return')

    await expect.poll(() => rows(page)).toEqual([])
  })

  test('with nothing to undo, Ctrl+Z changes nothing and moves nothing', async () => {
    const { page, press } = await launch(aHome())
    await openComposer(page)
    await page.focus(W_AMOUNT)
    press('ctrl+z')
    await settle(page)
    expect(await focused(page)).toBe('Write down a spend amount')
    expect(await rows(page)).toEqual([])
  })
})
