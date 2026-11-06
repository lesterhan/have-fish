// Writing a spend down on another day, and moving one, as a person does it, in the built app.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import { dateFrom } from '@have-fish/core/typed-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { understood } from '../renderer/format'
import { aHome, launch, PANE, rows, shownDay, unsavedInPane, WRITE, writeDown } from './app'

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
  test('the date is filled with today, and amount, what for, Enter never touches it', async () => {
    const { page } = await launch(aHome())
    expect(await page.inputValue(WRITE_DATE)).toBe(today())

    await writeDown(page, '4.50', 'Coffee')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])
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
      .toEqual([`${shownDay(today())} | Coffee | 4.50`, `${shownDay(daysAgo(2))} | Lunch | 12.00`])
    expect(await page.inputValue(WRITE_DATE)).toBe(today())
    expect(await focusedName(page)).toBe('amount')
  })

  test('a date cleared from the field is today', async () => {
    const { page } = await launch(aHome())

    await page.fill(`${WRITE} input[name=amount]`, '3')
    await page.fill(WRITE_DATE, '')
    await page.press(WRITE_DATE, 'Enter')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | — | 3.00`])
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
    expect(await unsavedInPane(page)).toBe(1)
    await page.press(PANE_DATE, 'Enter')

    await expect
      .poll(() => rows(page))
      .toEqual([`${shownDay(today())} | Coffee | 4.50`, `${shownDay(daysAgo(1))} | Lunch | 12.00`])
    expect(await unsavedInPane(page)).toBe(0)
    expect(await page.inputValue(PANE_DATE)).toBe(daysAgo(1))
  })

  test('Escape puts the date back', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await page.fill(PANE_DATE, daysAgo(3))
    await page.press(PANE_DATE, 'Escape')

    expect(await page.inputValue(PANE_DATE)).toBe(today())
    expect(await rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])
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
    expect(await rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50 | ●unsaved changes`])
  })
})

describe('type a date quickly', () => {
  const WRITE_UNDERSTOOD = `${WRITE} #date-understood`
  /** What a short form means today, here, and how the field says it. */
  const means = (typed: string) => {
    const date = dateFrom(typed, today())
    if (date === null) throw new Error(`can't read ${typed}`)
    return { date, said: understood(typed, today()) }
  }

  test.each(['y', '-3', 'mon', 'fri', '10-31'])(
    '%s: the field says the day it understood, and Enter saves it on that day',
    async (typed) => {
      const { page } = await launch(aHome())
      const { date, said } = means(typed)

      await page.fill(`${WRITE} input[name=amount]`, '5')
      await page.fill(WRITE_DATE, typed)
      await expect.poll(() => page.innerText(WRITE_UNDERSTOOD)).toBe(said)
      await page.press(WRITE_DATE, 'Enter')

      await expect.poll(() => rows(page)).toEqual([`${shownDay(date)} | — | 5.00`])
      expect(await page.inputValue(WRITE_DATE)).toBe(today())
    },
  )

  test('today is said as a day before I touch it', async () => {
    const { page } = await launch(aHome())
    expect(await page.innerText(WRITE_UNDERSTOOD)).toBe(understood(today(), today()))
  })

  test('something it can’t read: nothing is saved, and Date says how to type one', async () => {
    const { page } = await launch(aHome())
    await page.fill(`${WRITE} input[name=amount]`, '5')
    await page.fill(WRITE_DATE, 'soon')
    expect(await page.innerText(WRITE_UNDERSTOOD)).toBe('')
    await page.press(WRITE_DATE, 'Enter')

    await expect
      .poll(() => page.locator(`${WRITE} #date-error`).innerText())
      .toBe("That isn't a day it can read. Try y, -3, mon or 10-31.")
    expect(await page.getAttribute(WRITE_DATE, 'aria-invalid')).toBe('true')
    expect(await rows(page)).toEqual([])
  })

  test('the short way in the pane: y, Enter, and the spend moves to yesterday', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await page.fill(PANE_DATE, 'y')
    await expect
      .poll(() => page.innerText(`${PANE} #pane-date-understood`))
      .toBe(understood('y', today()))
    await page.press(PANE_DATE, 'Enter')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(daysAgo(1))} | Coffee | 4.50`])
    expect(await page.inputValue(PANE_DATE)).toBe(daysAgo(1))
  })
})
