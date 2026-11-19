// Writing down a spend in another currency in the built app: the code typed after the amount,
// the row and the wallet in that currency, and a chip that holds the code to change.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  accountLines,
  aHome,
  chip,
  goTo,
  launch,
  openChip,
  openSelected,
  PANE,
  rows,
  shownDay,
  writeDown,
} from './app'

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

const AMOUNT = `${PANE} input[name=amount]`
/** The amount chip while it's open: the editor around its field. */
const OPEN_AMOUNT = `${PANE} span:has(> span > input[name=amount])`

/** The wallet's line on Accounts. */
const cashLine = async (page: Page) =>
  (await accountLines(page)).find((line) => line.startsWith('cash'))

/** A fresh app with one spend of 1500 jpy, its row shown. */
async function aYenSpend() {
  const { page } = await launch(aHome())
  await writeDown(page, '1500 jpy', 'Ramen')
  await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Ramen | 1,500 JPY`])
  return page
}

/** A fresh app with 12, 35 eur and 1500 jpy written down, all three rows shown. */
async function threeCurrencies() {
  const { page } = await launch(aHome())
  await writeDown(page, '12', 'Lunch')
  await writeDown(page, '35 eur', 'Croissant')
  await writeDown(page, '1500 jpy', 'Ramen')
  await expect.poll(async () => (await rows(page)).length).toBe(3)
  return page
}

/**
 * Where a part of each named row's amount sits, from the left of the first row's: `left` or
 * `right` of the `[data-money=…]` span the row names.
 */
const offsets = (page: Page, edge: 'left' | 'right', parts: Record<string, string>) =>
  page.locator('ol[aria-label=Ledger] [role=option]').evaluateAll(
    (items, [edge, parts]) => {
      const at = Object.entries(parts).map(([name, part]) => {
        const row = items.find(
          (li) => li.querySelector('[data-cell=description]')?.textContent?.trim() === name,
        )
        const span = row?.querySelector(`[data-cell=amount] [data-money=${part}]`)
        return span?.getBoundingClientRect()[edge] ?? Number.NaN
      })
      return at.map((x) => x - (at[0] ?? Number.NaN))
    },
    [edge, parts] as const,
  )

/** An offset of under half a pixel: the same place, to the eye. */
const lined = () => expect.closeTo(0, 0)

describe('amounts in three currencies, down one column', () => {
  test('every code starts at one edge, the home currency’s empty slot too', async () => {
    const page = await threeCurrencies()

    await expect
      .poll(() => offsets(page, 'left', { Lunch: 'code', Croissant: 'code', Ramen: 'code' }))
      .toEqual([0, lined(), lined()])
  })

  test('the points line up, and the yen’s units end where they would', async () => {
    const page = await threeCurrencies()

    await expect
      .poll(() => offsets(page, 'right', { Lunch: 'figure', Croissant: 'figure', Ramen: 'blank' }))
      .toEqual([0, lined(), lined()])
  })

  test('the home currency’s empty slot adds no text to its row', async () => {
    const page = await threeCurrencies()

    await expect.poll(() => rows(page)).toContain(`${shownDay(today())} | Lunch | 12.00`)
  })
})

describe('write down a spend in another currency', () => {
  test('1500 jpy as the amount: the row reads 1,500 JPY', async () => {
    const { page } = await launch(aHome())

    await writeDown(page, '1500 jpy', 'Ramen')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Ramen | 1,500 JPY`])
  })

  test('its card says the amount in yen, as the row does', async () => {
    const page = await aYenSpend()

    await openSelected(page)

    await expect.poll(() => page.locator(chip('amount')).innerText()).toBe('1,500 JPY')
  })

  test('the wallet goes down in yen, and its dollars stay', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await goTo(page, 'Accounts')
    await expect.poll(() => cashLine(page)).toBe('cash | −12.00 CAD')

    await goTo(page, 'Ledger')
    await writeDown(page, '1500 jpy', 'Ramen')
    await goTo(page, 'Accounts')

    await expect.poll(() => cashLine(page)).toBe('cash | −12.00 CAD · −1,500 JPY')
  })

  test('the amount chip holds the code; deleting it makes the spend dollars', async () => {
    const page = await aYenSpend()

    await openSelected(page)
    await openChip(page, 'amount')
    await expect.poll(() => page.inputValue(AMOUNT)).toBe('1500 JPY')
    await page.fill(AMOUNT, '1500')
    await page.press(AMOUNT, 'Enter')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Ramen | 1,500.00`])
  })

  test('the open amount chip says the code once, in its field', async () => {
    const page = await aYenSpend()

    await openSelected(page)
    await openChip(page, 'amount')

    await expect.poll(() => page.inputValue(AMOUNT)).toBe('1500 JPY')
    expect(await page.locator(OPEN_AMOUNT).innerText()).not.toContain('JPY')
  })
})
