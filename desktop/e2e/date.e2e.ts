// Writing a spend down on another day, and moving one, as a person does it, in the built app.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import { dateFrom } from '@have-fish/core/typed-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  aHome,
  chip,
  launch,
  openChip,
  openComposer,
  openSelected,
  openSpend,
  PANE,
  rows,
  shownDay,
  WRITE,
  writeDown,
} from './app'

const DAY = 86_400_000
const here = Intl.DateTimeFormat().resolvedOptions().timeZone
/** The day `n` days before today, here. */
const daysAgo = (n: number) => calendarDateAt(Date.now() - n * DAY, here)
const today = () => daysAgo(0)

const WRITE_DATE = `${WRITE} input[name=date]`
const PANE_DATE = `${PANE} input[name=date]`
const LIST = 'ol[aria-label=Ledger]'
const row = (page: Page, text: string) => page.locator(`${LIST} li`, { hasText: text })
const focusedName = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('name'))

describe('write down a spend from another day', () => {
  test('the date starts as today, and amount, what for, Enter never touches it', async () => {
    const { page } = await launch(aHome())
    await page.waitForSelector(WRITE)
    expect(await page.inputValue(WRITE_DATE)).toBe('')
    expect(await page.getAttribute(WRITE_DATE, 'placeholder')).toBe('today')

    await writeDown(page, '4.50', 'Coffee')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])
  })

  test('the date is second in the Tab order, then amount and what for, then To', async () => {
    const { page } = await launch(aHome())
    await openComposer(page)
    await page.focus(`${WRITE} input[name=from]`)
    await page.keyboard.press('Tab')
    expect(await focusedName(page)).toBe('date')
    await page.keyboard.press('Tab')
    expect(await focusedName(page)).toBe('amount')
    await page.keyboard.press('Tab')
    expect(await focusedName(page)).toBe('description')
    await page.keyboard.press('Tab')
    expect(await focusedName(page)).toBe('to')
  })

  test('set a date, Enter: saved on that day, and the next line carries the date', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await openComposer(page)
    await page.fill(`${WRITE} input[name=amount]`, '12')
    await page.fill(`${WRITE} input[name=description]`, 'Lunch')
    await page.fill(WRITE_DATE, daysAgo(2))
    await page.press(WRITE_DATE, 'Enter')

    await expect
      .poll(() => rows(page))
      .toEqual([`${shownDay(today())} | Coffee | 4.50`, `${shownDay(daysAgo(2))} | Lunch | 12.00`])
    await openComposer(page)
    expect(await page.inputValue(WRITE_DATE)).toBe(daysAgo(2))
    expect(await focusedName(page)).toBe('amount')
  })

  test('a date cleared from the field is today', async () => {
    const { page } = await launch(aHome())
    await openComposer(page)

    await page.fill(`${WRITE} input[name=amount]`, '3')
    await page.fill(WRITE_DATE, '')
    await page.press(WRITE_DATE, 'Enter')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | — | 3.00`])
  })
})

describe('move a spend to another day', () => {
  test('change its date in its details, Enter: it moves into place in the list', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(2)

    await openSpend(row(page, 'Lunch'))
    await openChip(page, 'date')
    expect(await page.inputValue(PANE_DATE)).toBe(today())
    await page.fill(PANE_DATE, daysAgo(1))
    await page.press(PANE_DATE, 'Enter')

    await expect
      .poll(() => rows(page))
      .toEqual([`${shownDay(today())} | Coffee | 4.50`, `${shownDay(daysAgo(1))} | Lunch | 12.00`])
    expect(await page.locator(chip('date')).innerText()).toContain(shownDay(daysAgo(1)))
  })

  test('Escape puts the date back', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await openSelected(page)
    await openChip(page, 'date')
    await page.fill(PANE_DATE, daysAgo(3))
    await page.press(PANE_DATE, 'Escape')

    expect(await page.locator(chip('date')).innerText()).toContain(shownDay(today()))
    expect(await rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])
  })

  test('a date cleared: nothing is saved, and the field says why', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await openSelected(page)
    await openChip(page, 'date')
    await page.fill(PANE_DATE, '')
    await page.press(PANE_DATE, 'Enter')

    const error = page.locator(`${PANE} [role=alert]`)
    await expect.poll(() => error.textContent()).toMatch(/isn't a day/)
    expect(await page.getAttribute(PANE_DATE, 'aria-invalid')).toBe('true')
    expect(await rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])
  })
})

describe('type a date quickly', () => {
  const WRITE_LIST = `${WRITE} [role=listbox][aria-label="Days it can read"]`
  /** What a short form means today, here. */
  const means = (typed: string) => {
    const date = dateFrom(typed, today())
    if (date === null) throw new Error(`can't read ${typed}`)
    return { date, said: shownDay(date) }
  }

  test.each(['y', '-3', 'mon', 'fri', '10-31'])(
    '%s: the list says the day it means, and Enter saves it on that day',
    async (typed) => {
      const { page } = await launch(aHome())
      const { date, said } = means(typed)

      await openComposer(page)
      await page.fill(`${WRITE} input[name=amount]`, '5')
      await page.fill(WRITE_DATE, typed)
      await expect.poll(() => page.locator(WRITE_LIST).innerText()).toContain(said)
      await page.press(WRITE_DATE, 'Enter')

      await expect.poll(() => rows(page)).toEqual([`${shownDay(date)} | — | 5.00`])
    },
  )

  test('today is said as a day before I touch it', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await openComposer(page)
    await page.focus(WRITE_DATE)
    await expect.poll(() => page.locator(WRITE_LIST).innerText()).toContain(shownDay(today()))
  })

  test('something it can’t read: nothing is saved, and Date says why in two words', async () => {
    const { page } = await launch(aHome())
    await openComposer(page)
    await page.fill(`${WRITE} input[name=amount]`, '5')
    await page.fill(WRITE_DATE, 'soon')
    await page.press(WRITE_DATE, 'Enter')

    await expect.poll(() => page.locator(`${WRITE} [role=alert]`).innerText()).toBe('not a day')
    expect(await page.getAttribute(WRITE_DATE, 'aria-invalid')).toBe('true')
    expect(await rows(page)).toEqual([])
  })

  test('the short way in its details: y, Enter, and the spend moves to yesterday', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await openSelected(page)
    await openChip(page, 'date')

    await page.fill(PANE_DATE, 'y')
    await expect
      .poll(() => page.innerText(`${PANE} #pane-date-note`))
      .toBe(shownDay(dateFrom('y', today()) as string))
    await page.press(PANE_DATE, 'Enter')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(daysAgo(1))} | Coffee | 4.50`])
    expect(await page.locator(chip('date')).innerText()).toContain(shownDay(daysAgo(1)))
  })
})
