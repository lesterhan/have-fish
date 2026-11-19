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
    await expect.poll(() => cashLine(page)).toBe('cash | −12.00')

    await goTo(page, 'Ledger')
    await writeDown(page, '1500 jpy', 'Ramen')
    await goTo(page, 'Accounts')

    await expect.poll(() => cashLine(page)).toBe('cash | −12.00 · −1,500 JPY')
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
