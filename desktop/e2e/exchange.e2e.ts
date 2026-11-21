// Money changed between my accounts, in the built app: the line asks what arrived, the row reads
// it, Accounts moves both, the card says what it cost and keeps its amounts, and Reports leaves
// it out.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  accountLines,
  addAccount,
  aHome,
  chip,
  focusedName,
  goTo,
  launch,
  openComposer,
  openSelected,
  PANE,
  pickPath,
  reportTree,
  rows,
  shownDay,
  WRITE,
} from './app'

const ARRIVED = `${WRITE} input[name=arrived]`
/** The card's second sentence: what the exchange cost, and at what rate. */
const CONVERTED = `${PANE} p:has([aria-label="Charged"])`

/** The currency select's value for an account that holds any currency. */
const ANY = ''

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

/** A fresh app with wise:cad kept to CAD and wise:eur kept to EUR. */
async function withWise(): Promise<Page> {
  const { page } = await launch(aHome())
  await addAccount(page, 'wise:cad', 'bank', 'CAD')
  await addAccount(page, 'wise:eur', 'bank', 'EUR')
  return page
}

/** The line open: From `from`, `amount`, Wise for what, and To `to`, picked. */
async function line(page: Page, from: string, amount: string, to: string) {
  await openComposer(page)
  await pickPath(page, `${WRITE} input[name=from]`, from)
  await page.locator(`${WRITE} input[name=amount]`).focus()
  await page.keyboard.type(amount)
  await page.keyboard.press('Tab')
  await page.keyboard.type('Wise')
  await pickPath(page, `${WRITE} input[name=to]`, to)
}

/** `arrived` typed in its part, and Enter. */
async function arrive(page: Page, arrived: string) {
  await page.locator(ARRIVED).focus()
  await page.keyboard.type(arrived)
  await page.keyboard.press('Enter')
}

/** A fresh app with 100 CAD from wise:cad saved as the 80 EUR that arrived in wise:eur. */
async function anExchange(): Promise<Page> {
  const page = await withWise()
  await line(page, 'wise:cad', '100', 'wise:eur')
  await arrive(page, '80')
  await expect.poll(() => rows(page)).toHaveLength(1)
  return page
}

/** The card's second sentence, its spaces made one. */
const convertedLine = async (page: Page) =>
  ((await page.locator(CONVERTED).textContent()) ?? '').replace(/\s+/g, ' ').trim()

describe('100 from wise:cad to wise:eur', () => {
  test('the line asks what arrived, in EUR', async () => {
    const page = await withWise()

    await line(page, 'wise:cad', '100', 'wise:eur')

    await expect.poll(() => page.locator(ARRIVED).isVisible()).toBe(true)
    await expect.poll(() => page.getAttribute(ARRIVED, 'aria-label')).toBe('arrived, in EUR')
  })

  test('Tab from To goes to what arrived', async () => {
    const page = await withWise()
    await line(page, 'wise:cad', '100', 'wise:eur')

    await page.locator(`${WRITE} input[name=to]`).focus()
    await page.keyboard.press('Tab')

    await expect.poll(() => focusedName(page)).toBe('arrived')
  })

  test('80 and Enter: the row reads the 80.00 EUR that arrived', async () => {
    const page = await withWise()
    await line(page, 'wise:cad', '100', 'wise:eur')

    await arrive(page, '80')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Wise | ⇄ 80.00 EUR`])
  })

  test('after it, wise:cad has 100.00 CAD less and wise:eur 80.00 EUR more', async () => {
    const page = await anExchange()

    await goTo(page, 'Accounts')

    await expect
      .poll(() => accountLines(page))
      .toEqual(['wise | −100.00 CAD · 80.00 EUR', ':cad | −100.00 CAD', ':eur | 80.00 EUR'])
  })

  test('its card says the dollars it cost, and the rate', async () => {
    const page = await anExchange()

    await openSelected(page)

    await expect
      .poll(() => convertedLine(page))
      .toBe('with 100.00 CAD converted at 1 CAD = 0.8 EUR')
  })

  test('its card’s amount, charged and To chips are locked', async () => {
    const page = await anExchange()

    await openSelected(page)

    await expect.poll(() => page.locator(chip('amount')).isDisabled()).toBe(true)
    await expect.poll(() => page.locator(chip('charged')).isDisabled()).toBe(true)
    await expect.poll(() => page.locator(chip('to')).isDisabled()).toBe(true)
  })
})

describe('100 cad inside wise, which holds any currency', () => {
  /** A fresh app with wise, holding any currency, and the line from it to itself. */
  async function insideWise(): Promise<Page> {
    const { page } = await launch(aHome())
    await addAccount(page, 'wise', 'bank', ANY)
    await line(page, 'wise', '100 cad', 'wise')
    return page
  }

  test('the line asks what arrived, with its code', async () => {
    const page = await insideWise()

    await expect.poll(() => page.locator(ARRIVED).isVisible()).toBe(true)
    await expect.poll(() => page.getAttribute(ARRIVED, 'aria-label')).toBe('arrived, with its code')
  })

  test('80 eur and Enter: the row reads the 80.00 EUR that arrived', async () => {
    const page = await insideWise()

    await arrive(page, '80 eur')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Wise | ⇄ 80.00 EUR`])
  })
})

describe('an exchange refused or taken back', () => {
  test('Enter with what arrived empty: nothing is saved, and the part says not an amount', async () => {
    const page = await withWise()
    await line(page, 'wise:cad', '100', 'wise:eur')
    await page.locator(ARRIVED).focus()

    await page.keyboard.press('Enter')

    await expect.poll(() => page.locator(`${WRITE} [role=alert]`).innerText()).toBe('not an amount')
    expect(await rows(page)).toEqual([])
  })

  test('Ctrl+Z on the list takes the exchange back', async () => {
    const page = await anExchange()
    await page.keyboard.press('Escape')
    await page.waitForSelector(WRITE, { state: 'detached' })

    await page.locator('ol[aria-label=Ledger]').focus()
    await page.keyboard.press('Control+z')

    await expect.poll(() => rows(page)).toEqual([])
  })

  test('Reports leaves it out: the tree has no category', async () => {
    const page = await anExchange()

    await goTo(page, 'Reports')

    await expect.poll(() => reportTree(page)).toEqual([])
  })
})
