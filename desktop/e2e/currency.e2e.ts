// Writing down a spend in another currency in the built app: the code typed after the amount,
// the row and the wallet in that currency, and a chip that holds the code to change.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, openChip, openSelected, PANE, rows, shownDay, writeDown } from './app'

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

const NAV = 'nav[aria-label=Places]'
const AMOUNT = `${PANE} input[name=amount]`

/** The wallet's line on Accounts: its name and balance, as the cells read. */
const cashLine = (page: Page) =>
  page
    .locator('ol[aria-label=Accounts] li', { hasText: 'cash' })
    .evaluateAll((items) =>
      items.map((li) =>
        [...li.querySelectorAll('[data-cell]')].map((c) => c.textContent?.trim() ?? '').join(' | '),
      ),
    )

const toPlace = (page: Page, place: string) => page.click(`${NAV} button:has-text("${place}")`)

describe('write down a spend in another currency', () => {
  test('1500 jpy as the amount: the row reads 1,500 JPY', async () => {
    const { page } = await launch(aHome())

    await writeDown(page, '1500 jpy', 'Ramen')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Ramen | 1,500 JPY`])
  })

  test('the wallet goes down in yen, and its dollars stay', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await toPlace(page, 'Accounts')
    await expect.poll(() => cashLine(page)).toEqual(['cash | −12.00'])

    await toPlace(page, 'Ledger')
    await writeDown(page, '1500 jpy', 'Ramen')
    await toPlace(page, 'Accounts')

    await expect.poll(() => cashLine(page)).toEqual(['cash | −12.00 · −1,500 JPY'])
  })

  test('the amount chip holds the code; deleting it makes the spend dollars', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '1500 jpy', 'Ramen')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await openSelected(page)
    await openChip(page, 'amount')
    await expect.poll(() => page.inputValue(AMOUNT)).toBe('1500 JPY')
    await page.fill(AMOUNT, '1500')
    await page.press(AMOUNT, 'Enter')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Ramen | 1,500.00`])
  })
})
