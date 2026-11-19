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

/** The Ledger's rows. */
const LEDGER_ROWS = 'ol[aria-label=Ledger] [role=option]'

/** Where each named row's code starts, from the left of the first row's. */
const codeStarts = (page: Page, names: string[]) =>
  page.locator(LEDGER_ROWS).evaluateAll((items, names) => {
    const at = names.map((name) => {
      const row = items.find(
        (li) => li.querySelector('[data-cell=description]')?.textContent?.trim() === name,
      )
      const code = row?.querySelector('[data-cell=amount] [data-money=code]')
      return code?.getBoundingClientRect().left ?? Number.NaN
    })
    return at.map((x) => x - (at[0] ?? Number.NaN))
  }, names)

/**
 * Where the point in each of `pointed`'s figures starts, from where `whole`'s figure ends: a
 * Range over the `.`, since the point is a character and has no box of its own.
 */
const pointsFrom = (page: Page, whole: string, pointed: string[]) =>
  page.locator(LEDGER_ROWS).evaluateAll(
    (items, [whole, pointed]) => {
      const figure = (name: string) =>
        items
          .find((li) => li.querySelector('[data-cell=description]')?.textContent?.trim() === name)
          ?.querySelector('[data-cell=amount] [data-money=figure]')
      const end = figure(whole)?.getBoundingClientRect().right ?? Number.NaN
      return pointed.map((name) => {
        const text = figure(name)?.firstChild
        if (!(text instanceof Text) || !text.data.includes('.')) return Number.NaN
        const range = document.createRange()
        range.setStart(text, text.data.indexOf('.'))
        range.setEnd(text, text.data.indexOf('.') + 1)
        return range.getBoundingClientRect().left - end
      })
    },
    [whole, pointed] as const,
  )

/**
 * How far each row's amount runs past its grid track: the cell is justify-self: end and grows
 * with what it holds, so only the track says where the column ends.
 */
const overruns = (page: Page) =>
  page.locator(LEDGER_ROWS).evaluateAll((items) =>
    items.map((li) => {
      const cells = [...li.querySelectorAll('[data-cell]')]
      const amount = cells.find((c) => c.getAttribute('data-cell') === 'amount')
      const tracks = getComputedStyle(li).gridTemplateColumns.split(' ')
      const track = Number.parseFloat(tracks[amount ? cells.indexOf(amount) : -1] ?? 'NaN')
      return Math.max(0, (amount?.getBoundingClientRect().width ?? Number.NaN) - track)
    }),
  )

/** An offset of under half a pixel: the same place, to the eye. */
const lined = () => expect.closeTo(0, 0)

describe('amounts in three currencies, down one column', () => {
  test('every code starts at one edge, the home currency’s empty slot too', async () => {
    const page = await threeCurrencies()

    await expect
      .poll(() => codeStarts(page, ['Lunch', 'Croissant', 'Ramen']))
      .toEqual([0, lined(), lined()])
  })

  test('the yen’s units end where the others’ points start', async () => {
    const page = await threeCurrencies()

    await expect
      .poll(() => pointsFrom(page, 'Ramen', ['Lunch', 'Croissant']))
      .toEqual([lined(), lined()])
  })

  test('the home currency’s empty slot adds no text to its row', async () => {
    const page = await threeCurrencies()

    await expect.poll(() => rows(page)).toContain(`${shownDay(today())} | Lunch | 12.00`)
  })

  test('the widest amounts, slot and blank included, stay inside their column', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12345.67', 'Rent')
    await writeDown(page, '150000 jpy', 'Hotel')

    await expect.poll(() => overruns(page)).toEqual([lined(), lined()])
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
