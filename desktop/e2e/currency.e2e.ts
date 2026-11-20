// Writing down a spend in another currency in the built app: the code typed after the amount,
// the row and the wallet in that currency, and a chip that holds the code to change.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  ADD_ACCOUNT,
  accountLines,
  aHome,
  BATCH,
  chip,
  goTo,
  launch,
  openChip,
  openComposer,
  openSelected,
  PANE,
  pickPath,
  rows,
  shownDay,
  WRITE,
  writeDown,
} from './app'

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

const AMOUNT = `${PANE} input[name=amount]`
const ADDING = 'section[aria-label="The account"] form[aria-label="Add an account"]'
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

/** A list down which amounts line up: its rows, the cell naming each, the cell holding its amount. */
type Column = { rows: string; name: string; amount: string }

const LEDGER: Column = {
  rows: 'ol[aria-label=Ledger] [role=option]',
  name: 'description',
  amount: 'amount',
}
const BATCH_LINES: Column = { rows: `${BATCH} li`, name: 'description', amount: 'amount' }
const ACCOUNTS: Column = { rows: 'ol[aria-label=Accounts] li', name: 'name', amount: 'balance' }

/** Where each named row's code starts, from the left of the first row's. */
const codeStarts = (page: Page, column: Column, names: string[]) =>
  page.locator(column.rows).evaluateAll(
    (items, [column, names]) => {
      const at = names.map((name) => {
        const row = items.find(
          (li) =>
            li.querySelector(`[data-cell=${column.name}]`)?.textContent?.trim().split(/\s+/)[0] ===
            name,
        )
        const code = row?.querySelector(`[data-cell=${column.amount}] [data-money=code]`)
        return code?.getBoundingClientRect().left ?? Number.NaN
      })
      return at.map((x) => x - (at[0] ?? Number.NaN))
    },
    [column, names] as const,
  )

/**
 * Where the point in each of `pointed`'s figures starts, from where `whole`'s figure ends: a
 * Range over the `.`, since the point is a character and has no box of its own.
 */
const pointsFrom = (page: Page, column: Column, whole: string, pointed: string[]) =>
  page.locator(column.rows).evaluateAll(
    (items, [column, whole, pointed]) => {
      const figure = (name: string) =>
        items
          .find(
            (li) =>
              li
                .querySelector(`[data-cell=${column.name}]`)
                ?.textContent?.trim()
                .split(/\s+/)[0] === name,
          )
          ?.querySelector(`[data-cell=${column.amount}] [data-money=figure]`)
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
    [column, whole, pointed] as const,
  )

/**
 * How far each Ledger row's amount runs past its grid track: the cell is justify-self: end and
 * grows with what it holds, so only the track says where the column ends.
 */
const overruns = (page: Page) =>
  page.locator(LEDGER.rows).evaluateAll((items) =>
    items.map((li) => {
      const cells = [...li.querySelectorAll('[data-cell]')]
      const at = cells.findIndex((c) => c.getAttribute('data-cell') === 'amount')
      const track = Number.parseFloat(getComputedStyle(li).gridTemplateColumns.split(' ')[at] ?? '')
      return Math.max(0, (cells[at]?.getBoundingClientRect().width ?? Number.NaN) - track)
    }),
  )

/** Within half a pixel of zero: the same place, to the eye. */
const withinHalfAPixel = () => expect.closeTo(0, 0)

/** Adds a bank account in one currency on Accounts, with what's in it today. */
async function addBank(page: Page, name: string, currency: string, start: string) {
  await goTo(page, 'Accounts')
  await page.click(ADD_ACCOUNT)
  await page.fill(`${ADDING} input[name=name]`, name)
  await page.selectOption(`${ADDING} select[name=kind]`, 'bank')
  await page.selectOption(`${ADDING} select[name=currency]`, currency)
  await page.click(`${ADDING} details summary`)
  await page.fill(`${ADDING} input[name=start]`, start)
  await page.locator(`${ADDING} input[name=name]`).press('Enter')
  await page.waitForSelector(`${ACCOUNTS.rows}[data-id]:has-text("${name}")`)
}

/** Money moved into an account, from another or from an income, as the line writes it. */
async function move(page: Page, amount: string, description: string, from: string, to: string) {
  const before = (await rows(page)).length
  await openComposer(page)
  await page.fill(`${WRITE} input[name=amount]`, amount)
  await page.fill(`${WRITE} input[name=description]`, description)
  await pickPath(page, `${WRITE} input[name=to]`, to)
  await pickPath(page, `${WRITE} input[name=from]`, from)
  await page.press(`${WRITE} input[name=amount]`, 'Enter')
  await expect.poll(async () => (await rows(page)).length).toBe(before + 1)
}

/** A line written and kept open, as a person writes a batch: its row in the batch is the write. */
async function writeLine(page: Page, amount: string, description: string) {
  const before = await page.locator(BATCH_LINES.rows).count()
  await openComposer(page)
  await page.fill(`${WRITE} input[name=amount]`, amount)
  await page.fill(`${WRITE} input[name=description]`, description)
  await page.press(`${WRITE} input[name=amount]`, 'Enter')
  await expect.poll(() => page.locator(BATCH_LINES.rows).count()).toBe(before + 1)
}

describe('amounts in three currencies, down one column', () => {
  test('every code starts at one edge, the home currency’s empty slot too', async () => {
    const page = await threeCurrencies()

    await expect
      .poll(() => codeStarts(page, LEDGER, ['Lunch', 'Croissant', 'Ramen']))
      .toEqual([0, withinHalfAPixel(), withinHalfAPixel()])
  })

  test('the yen’s units end where the others’ points start', async () => {
    const page = await threeCurrencies()

    await expect
      .poll(() => pointsFrom(page, LEDGER, 'Ramen', ['Lunch', 'Croissant']))
      .toEqual([withinHalfAPixel(), withinHalfAPixel()])
  })

  test('the home currency’s empty slot adds no text to its row', async () => {
    const page = await threeCurrencies()

    await expect.poll(() => rows(page)).toContain(`${shownDay(today())} | Lunch | 12.00`)
  })

  test('the widest amounts, slot and blank included, stay inside their column', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12345.67', 'Rent')
    await writeDown(page, '150000 jpy', 'Hotel')
    await addBank(page, 'yen', 'JPY', '0')
    await goTo(page, 'Ledger')
    await move(page, '150000 jpy', 'Float', 'cash', 'yen')
    await move(page, '12345.67', 'Pay', 'salary', 'cash')

    await expect
      .poll(() => overruns(page))
      .toEqual([withinHalfAPixel(), withinHalfAPixel(), withinHalfAPixel(), withinHalfAPixel()])
  })
})

describe('amounts in two currencies line up on Accounts and in the batch too', () => {
  test('on Accounts, a yen account’s units end at a dollar account’s point, codes at one edge', async () => {
    const { page } = await launch(aHome())
    await addBank(page, 'chequing', 'CAD', '500')
    await addBank(page, 'yen', 'JPY', '1500')

    await expect
      .poll(() => pointsFrom(page, ACCOUNTS, 'yen', ['chequing']))
      .toEqual([withinHalfAPixel()])
    expect(await codeStarts(page, ACCOUNTS, ['chequing', 'yen'])).toEqual([0, withinHalfAPixel()])
  })

  test('in the batch, the yen’s units end at the dollars’ point, codes at one edge', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '12', 'Lunch')
    await writeLine(page, '1500 jpy', 'Ramen')

    await expect
      .poll(() => pointsFrom(page, BATCH_LINES, 'Ramen', ['Lunch']))
      .toEqual([withinHalfAPixel()])
    expect(await codeStarts(page, BATCH_LINES, ['Lunch', 'Ramen'])).toEqual([0, withinHalfAPixel()])
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
