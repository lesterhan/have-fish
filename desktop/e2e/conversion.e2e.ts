// A yen spend a card kept to CAD paid, in the built app: the line asks what the card was charged,
// the row reads the yen, the card says the dollars and the rate, and the card owes the dollars.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { copy } from '../copy'
import {
  ADD_ACCOUNT,
  accountLines,
  aHome,
  chip,
  focusedName,
  goTo,
  launch,
  openChip,
  openComposer,
  openSelected,
  PANE,
  pickPath,
  reportTree,
  rows,
  shownDay,
  WRITE,
} from './app'

const ADDING = 'section[aria-label="The account"] form[aria-label="Add an account"]'
const AMOUNT = `${WRITE} input[name=amount]`
const CHARGED = `${WRITE} input[name=charged]`
/** The card's second sentence: what paid for it, and at what rate. */
const CONVERTED = `${PANE} p:has([aria-label="Charged"])`
/** The charged chip's field, open in the card. */
const CHARGED_FIELD = `${PANE} input[name=charged]`

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

/** Adds an account on the Accounts place, kept to `currency` if given, then back to the ledger. */
async function addAccount(page: Page, name: string, kind: string, currency?: string) {
  await goTo(page, 'Accounts')
  await page.click(ADD_ACCOUNT)
  await page.fill(`${ADDING} input[name=name]`, name)
  await page.selectOption(`${ADDING} select[name=kind]`, kind)
  if (currency !== undefined) await page.selectOption(`${ADDING} select[name=currency]`, currency)
  await page.locator(`${ADDING} input[name=name]`).press('Enter')
  await page.waitForSelector(`ol[aria-label=Accounts] li[data-id]:has-text("${name}")`)
  await goTo(page, 'Ledger')
}

/** A fresh app with visa, a card kept to CAD. */
async function withVisa(): Promise<Page> {
  const { page } = await launch(aHome())
  await addAccount(page, 'visa', 'card', 'CAD')
  return page
}

/** The line open, From visa, and `amount` typed in the amount, where the cursor stays. */
async function fromVisa(page: Page, amount: string) {
  await openComposer(page)
  await pickPath(page, `${WRITE} input[name=from]`, 'visa')
  await page.locator(AMOUNT).focus()
  await page.keyboard.type(amount)
}

/** ¥4,000 for dinner from visa, charged 36.20: typed, Tab by Tab, saved, and the line closed. */
async function writeDinner(page: Page) {
  await fromVisa(page, '4000 jpy')
  await page.keyboard.press('Tab')
  await page.keyboard.type('36.20')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Dinner')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForSelector(WRITE, { state: 'detached' })
}

/** A fresh app with the dinner written, its row shown. */
async function aDinner(): Promise<Page> {
  const page = await withVisa()
  await writeDinner(page)
  await expect.poll(() => rows(page)).toHaveLength(1)
  return page
}

/** The card's second sentence, its spaces made one. */
const convertedLine = async (page: Page) =>
  ((await page.locator(CONVERTED).textContent()) ?? '').replace(/\s+/g, ' ').trim()

describe('a yen spend my CAD card paid', () => {
  test('4000 jpy from visa: the line asks what it was charged, in CAD, and Tab goes there', async () => {
    const page = await withVisa()

    await fromVisa(page, '4000 jpy')

    await expect.poll(() => page.locator(CHARGED).isVisible()).toBe(true)
    await expect
      .poll(() => page.locator(CHARGED).evaluate((input) => input.nextSibling?.textContent))
      .toBe('CAD')
    await page.keyboard.press('Tab')
    await expect.poll(() => focusedName(page)).toBe('charged')
  })

  test('4000 with no code from visa: no charge is asked, and Tab goes to the description', async () => {
    const page = await withVisa()

    await fromVisa(page, '4000')
    await page.keyboard.press('Tab')

    await expect.poll(() => focusedName(page)).toBe('description')
    expect(await page.locator(CHARGED).count()).toBe(0)
  })

  test('saved with its charge, the row reads 4,000 JPY', async () => {
    const page = await withVisa()

    await writeDinner(page)

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,000 JPY`])
  })

  test('its card says the dollars it was charged, and the rate', async () => {
    const page = await aDinner()

    await openSelected(page)

    await expect
      .poll(() => convertedLine(page))
      .toBe('with 36.20 CAD converted at 1 CAD = 110.5 JPY')
  })

  test('visa owes the 36.20 it was charged', async () => {
    const page = await aDinner()

    await goTo(page, 'Accounts')

    await expect.poll(() => accountLines(page)).toEqual(['visa | owed 36.20 CAD'])
  })

  test('a charge typed, then the code taken off the amount: the part goes, and it is not sent', async () => {
    const page = await withVisa()
    await fromVisa(page, '4000 jpy')
    await page.keyboard.press('Tab')
    await page.keyboard.type('36.20')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Dinner')

    await page.fill(AMOUNT, '4000')
    await expect.poll(() => page.locator(CHARGED).count()).toBe(0)
    await page.press(AMOUNT, 'Enter')
    await page.keyboard.press('Escape')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,000.00`])
    await openSelected(page)
    await expect.poll(() => page.locator(chip('amount')).innerText()).toBe('4,000.00 CAD')
    expect(await page.locator(CONVERTED).count()).toBe(0)
  })

  test('to an account of mine, no charge is asked, and the yen are refused as locked', async () => {
    const page = await withVisa()
    await addAccount(page, 'cash', 'cash')
    await fromVisa(page, '4000 jpy')
    await expect.poll(() => page.locator(CHARGED).isVisible()).toBe(true)

    await pickPath(page, `${WRITE} input[name=to]`, 'cash')
    await expect.poll(() => page.locator(CHARGED).count()).toBe(0)
    await page.press(AMOUNT, 'Enter')

    await expect
      .poll(() => page.locator(`${WRITE} [role=alert]`).innerText())
      .toBe('currency locked')
    expect(await rows(page)).toEqual([])
  })

  test('with From left empty, the line asks as for visa, the account it assumes', async () => {
    const page = await aDinner()
    await openComposer(page)
    await page.fill(`${WRITE} input[name=from]`, '')
    await page.locator(AMOUNT).focus()
    await expect.poll(() => page.inputValue(`${WRITE} input[name=from]`)).toBe('')

    await page.keyboard.type('4000 jpy')

    await expect.poll(() => page.locator(CHARGED).isVisible()).toBe(true)
    await expect
      .poll(() => page.locator(CHARGED).evaluate((input) => input.nextSibling?.textContent))
      .toBe('CAD')
  })

  test('the next line asks for its own charge: the last one saved is not carried', async () => {
    const page = await aDinner()

    await fromVisa(page, '4000 jpy')

    await expect.poll(() => page.locator(CHARGED).isVisible()).toBe(true)
    expect(await page.inputValue(CHARGED)).toBe('')
  })

  test('Enter with the charge empty: nothing is saved, and the part says not an amount', async () => {
    const page = await withVisa()
    await fromVisa(page, '4000 jpy')

    await page.keyboard.press('Enter')

    await expect.poll(() => page.getAttribute(CHARGED, 'aria-invalid')).toBe('true')
    await expect.poll(() => page.locator(`${WRITE} [role=alert]`).innerText()).toBe('not an amount')
    expect(await rows(page)).toEqual([])
  })
})

describe('fixing the amounts of a converted spend', () => {
  /** The dinner's card open, `part`'s chip opened, `typed` in its field, and Enter. */
  async function change(page: Page, part: string, typed: string) {
    await openSelected(page)
    await openChip(page, part)
    await page.fill(`${PANE} input[name=${part}]`, typed)
    await page.press(`${PANE} input[name=${part}]`, 'Enter')
  }

  test('the amount chip, 4500 jpy and Enter: the row reads 4,500 JPY', async () => {
    const page = await aDinner()

    await change(page, 'amount', '4500 jpy')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,500 JPY`])
  })

  test('after 4500 jpy, the card still says the 36.20 charged, at its new rate', async () => {
    const page = await aDinner()

    await change(page, 'amount', '4500 jpy')

    await expect
      .poll(() => convertedLine(page))
      .toBe('with 36.20 CAD converted at 1 CAD = 124.3 JPY')
  })

  test('after 4500 jpy, visa still owes the 36.20', async () => {
    const page = await aDinner()
    await change(page, 'amount', '4500 jpy')
    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,500 JPY`])

    await goTo(page, 'Accounts')

    await expect.poll(() => accountLines(page)).toEqual(['visa | owed 36.20 CAD'])
  })

  test('the charged chip opens holding 36.20', async () => {
    const page = await aDinner()
    await openSelected(page)

    await openChip(page, 'charged')

    await expect.poll(() => page.inputValue(CHARGED_FIELD)).toBe('36.20')
  })

  test('the charged chip opens with CAD after its field', async () => {
    const page = await aDinner()
    await openSelected(page)

    await openChip(page, 'charged')

    await expect
      .poll(() => page.locator(CHARGED_FIELD).evaluate((input) => input.nextSibling?.textContent))
      .toBe('CAD')
  })

  test('the charged chip, 38.10 and Enter: visa owes 38.10', async () => {
    const page = await aDinner()
    await change(page, 'charged', '38.10')
    await expect.poll(() => page.locator(CHARGED_FIELD).count()).toBe(0)

    await goTo(page, 'Accounts')

    await expect.poll(() => accountLines(page)).toEqual(['visa | owed 38.10 CAD'])
  })

  test('after 38.10, the row still reads 4,000 JPY', async () => {
    const page = await aDinner()

    await change(page, 'charged', '38.10')

    await expect.poll(() => convertedLine(page)).toContain('38.10 CAD')
    expect(await rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,000 JPY`])
  })

  test('the amount chip, 40 and Enter: the card has no converted line', async () => {
    const page = await aDinner()
    await openSelected(page)
    expect(await page.locator(CONVERTED).count()).toBe(1)

    await openChip(page, 'amount')
    await page.fill(`${PANE} input[name=amount]`, '40')
    await page.press(`${PANE} input[name=amount]`, 'Enter')

    await expect.poll(() => page.locator(CONVERTED).count()).toBe(0)
  })

  test('after 40, visa owes 40.00', async () => {
    const page = await aDinner()
    await change(page, 'amount', '40')
    await expect.poll(() => page.locator(CONVERTED).count()).toBe(0)

    await goTo(page, 'Accounts')

    await expect.poll(() => accountLines(page)).toEqual(['visa | owed 40.00 CAD'])
  })

  test('the amount chip, 30 eur and Enter: converted from the same 36.20, at a euro rate', async () => {
    const page = await aDinner()

    await change(page, 'amount', '30 eur')

    await expect
      .poll(() => convertedLine(page))
      .toBe('with 36.20 CAD converted at 1 CAD = 0.8287 EUR')
  })

  test('after 40, Ctrl+Z on the list: the card converts the 36.20 again', async () => {
    const page = await aDinner()
    await change(page, 'amount', '40')
    await expect.poll(() => page.locator(CONVERTED).count()).toBe(0)

    await page.locator('ol[aria-label=Ledger]').focus()
    await page.keyboard.press('Control+z')

    await expect
      .poll(() => convertedLine(page))
      .toBe('with 36.20 CAD converted at 1 CAD = 110.5 JPY')
  })

  test('the charged chip, abc and Enter: the chip says why', async () => {
    const page = await aDinner()

    await change(page, 'charged', 'abc')

    await expect
      .poll(() => page.locator(`${PANE} [role=alert]`).innerText())
      .toBe(copy.errors.codes.CHARGED_INVALID)
  })

  test('the charged chip cleared, and Enter: the chip says why', async () => {
    const page = await aDinner()

    await change(page, 'charged', '')

    await expect
      .poll(() => page.locator(`${PANE} [role=alert]`).innerText())
      .toBe(copy.errors.codes.CHARGED_INVALID)
  })

  test('its card’s Rate chip is locked', async () => {
    const page = await aDinner()

    await openSelected(page)

    await expect.poll(() => page.locator(`${PANE} [aria-label="Rate"]`).isDisabled()).toBe(true)
  })
})

describe('a converted spend in Reports', () => {
  test('the dinner: Unsorted counts the 36.20 it cost', async () => {
    const page = await aDinner()
    // Wide enough for the week before's column.
    await page.setViewportSize({ width: 1440, height: 900 })

    await goTo(page, 'Reports')

    await expect.poll(() => reportTree(page)).toEqual(['Unsorted | 36.20 | – | 36.20 more'])
  })

  test('beside 1500 yen in cash: the line under the tree says only the 1,500 JPY', async () => {
    const page = await aDinner()
    await addAccount(page, 'suica', 'cash', 'JPY')
    await openComposer(page)
    await pickPath(page, `${WRITE} input[name=from]`, 'suica')
    await page.fill(AMOUNT, '1500')
    await page.press(AMOUNT, 'Enter')
    await page.keyboard.press('Escape')
    await expect.poll(() => rows(page)).toHaveLength(2)

    await goTo(page, 'Reports')

    await expect
      .poll(() => page.getByText(copy.reports.tree.other('1,500 JPY'), { exact: true }).isVisible())
      .toBe(true)
  })
})
