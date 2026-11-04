// Writing a spend down on another day, and moving one, as a person does it, in the built app.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, PANE, rows, WRITE, writeDown } from './app'

const DAY = 86_400_000
const here = Intl.DateTimeFormat().resolvedOptions().timeZone
/** The day `n` days before today, here. */
const daysAgo = (n: number) => calendarDateAt(Date.now() - n * DAY, here)
const today = () => daysAgo(0)

const WRITE_DATE = `${WRITE} input[name=date]`
const PANE_DATE = `${PANE} input[name=date]`
const LIST = 'ol[aria-label=Spends]'
const row = (page: Page, text: string) => page.locator(`${LIST} li`, { hasText: text })
const focusedName = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('name'))

describe('write down a spend from another day', () => {
  test('the date is filled with today, and amount, what for, Enter never touches it', async () => {
    const { page } = await launch(aHome())
    expect(await page.inputValue(WRITE_DATE)).toBe(today())

    await writeDown(page, '4.50', 'Coffee')

    await expect.poll(() => rows(page)).toEqual([`${today()} | Coffee | 4.50 CAD`])
  })

  test('the date is last in the Tab order, so What for still Tabs straight to To', async () => {
    const { page } = await launch(aHome())
    await page.focus(`${WRITE} input[name=description]`)
    await page.keyboard.press('Tab')
    expect(await focusedName(page)).toBe('to')
    await page.keyboard.press('Tab')
    expect(await focusedName(page)).toBe('from')
    await page.keyboard.press('Tab')
    expect(await focusedName(page)).toBe('date')
  })

  test('set a date, Enter: saved on that day, sorted below today, and the field is today again', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await page.fill(`${WRITE} input[name=amount]`, '12')
    await page.fill(`${WRITE} input[name=description]`, 'Lunch')
    await page.fill(WRITE_DATE, daysAgo(2))
    await page.press(WRITE_DATE, 'Enter')

    await expect
      .poll(() => rows(page))
      .toEqual([`${today()} | Coffee | 4.50 CAD`, `${daysAgo(2)} | Lunch | 12.00 CAD`])
    expect(await page.inputValue(WRITE_DATE)).toBe(today())
    expect(await focusedName(page)).toBe('amount')
  })

  test('a date cleared from the field is today', async () => {
    const { page } = await launch(aHome())

    await page.fill(`${WRITE} input[name=amount]`, '3')
    await page.fill(WRITE_DATE, '')
    await page.press(WRITE_DATE, 'Enter')

    await expect.poll(() => rows(page)).toEqual([`${today()} | — | 3.00 CAD`])
  })
})

describe('move a spend to another day', () => {
  test('change its date in the pane, Enter: it moves into place in the list', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(2)

    await row(page, 'Lunch').click()
    expect(await page.inputValue(PANE_DATE)).toBe(today())
    await page.fill(PANE_DATE, daysAgo(1))
    expect(await page.textContent(`${PANE} .heading`)).toContain('●')
    await page.press(PANE_DATE, 'Enter')

    await expect
      .poll(() => rows(page))
      .toEqual([`${today()} | Coffee | 4.50 CAD`, `${daysAgo(1)} | Lunch | 12.00 CAD`])
    expect(await page.textContent(`${PANE} .heading`)).not.toContain('●')
    expect(await page.inputValue(PANE_DATE)).toBe(daysAgo(1))
  })

  test('Escape puts the date back', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await page.fill(PANE_DATE, daysAgo(3))
    await page.press(PANE_DATE, 'Escape')

    expect(await page.inputValue(PANE_DATE)).toBe(today())
    expect(await rows(page)).toEqual([`${today()} | Coffee | 4.50 CAD`])
  })

  test('a date cleared: nothing is saved, and the field says why', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await page.fill(PANE_DATE, '')
    await page.press(PANE_DATE, 'Enter')

    const error = page.locator('#pane-date-error')
    await expect.poll(() => error.textContent()).toMatch(/isn't a day/)
    expect(await page.getAttribute(PANE_DATE, 'aria-invalid')).toBe('true')
    expect(await rows(page)).toEqual([`${today()} | Coffee | 4.50 CAD | ●unsaved changes`])
  })
})
