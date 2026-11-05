// Saying which account paid, from the spend form: Entry-4's acceptance, with real keys.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { ADD_ACCOUNT, aHome, cellsOf, fromLine, launch, rows, WRITE, writeDown } from './app'

const NAV = 'nav[aria-label=Places]'
const ADDING = 'section[aria-label="The account"] form[aria-label="Add an account"]'
const AMOUNT = `${WRITE} input[name=amount]`
const FROM = `${WRITE} input[name=from]`
const OPTIONS = `${WRITE} [role=listbox][aria-label="Your accounts and income"]`

const today = () => new Date().toLocaleDateString('en-CA')

/** Adds an account on the Accounts place, then comes back to Spends. */
async function addAccount(page: Page, name: string, kind: string, currency?: string) {
  await page.click(`${NAV} button:has-text("Accounts")`)
  await page.click(ADD_ACCOUNT)
  await page.fill(`${ADDING} input[name=name]`, name)
  await page.selectOption(`${ADDING} select[name=kind]`, kind)
  if (currency !== undefined) await page.selectOption(`${ADDING} select[name=currency]`, currency)
  await page.locator(`${ADDING} input[name=name]`).press('Enter')
  await page.waitForSelector(`ol[aria-label=Accounts] li:has-text("${name}")`)
  await page.click(`${NAV} button:has-text("Spends")`)
}

/** Amount, Tab, what for, Tab past To, Tab: the cursor in From, emptied. */
async function upToFrom(page: Page, amount: string, description: string) {
  await page.locator(AMOUNT).focus()
  await page.keyboard.type(amount)
  await page.keyboard.press('Tab')
  await page.keyboard.type(description)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
}

const offered = (page: Page) =>
  cellsOf(page.locator(`${OPTIONS} [role=option]`)).then((rows) => rows.map(([name]) => name))
const from = (page: Page) => page.inputValue(FROM)
/** The account the selected spend came out of, as the pane says it. */
const paidFrom = (page: Page) =>
  fromLine(page)
    .innerText()
    .then((t) => t.replace(/^From\s+/, ''))

describe('picking the account that paid', () => {
  test('typed and picked with Enter, the spend comes out of it, and says so', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'visa', 'card')

    await upToFrom(page, '30', 'Dinner')
    await page.keyboard.type('vi')
    await expect.poll(() => offered(page)).toEqual(['visa', 'Create income:vi'])
    await page.keyboard.press('Enter')
    expect(await from(page)).toBe('visa')
    expect(await rows(page)).toEqual([])

    await page.keyboard.press('Enter')
    await expect.poll(() => rows(page)).toEqual([`${today()} | Dinner | 30.00 CAD`])
    expect(await fromLine(page).innerText()).toMatch(/^From\s+visa$/)
  })

  test('accounts I have added are offered, never a category', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await addAccount(page, 'visa', 'card')
    await addAccount(page, 'Chequing', 'bank')

    await upToFrom(page, '1', 'Gum')
    await page.keyboard.type('c')
    await expect.poll(() => offered(page)).toEqual(['cash', 'Chequing', 'Create income:c'])
    await page.keyboard.press('Backspace')
    await page.keyboard.type('unsorted')
    // A name none of mine has is offered only as somewhere money comes in from.
    await expect.poll(() => offered(page)).toEqual(['Create income:unsorted'])
  })

  test('Down shows them all; the arrows move; Escape puts back what was there', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await addAccount(page, 'visa', 'card')

    await page.locator(FROM).focus()
    expect(await from(page)).toBe('cash')
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => offered(page)).toEqual(['cash', 'visa'])
    await page.keyboard.press('ArrowDown')
    expect(await page.locator(`${OPTIONS} [aria-selected=true]`).innerText()).toMatch(/^visa/)
    await page.keyboard.type('xyz')
    await page.keyboard.press('Escape')

    expect(await from(page)).toBe('cash')
    expect(await page.isVisible(OPTIONS)).toBe(false)
  })

  test('a name that is none of mine, to a category, is refused, and To says why', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'visa', 'card')

    await upToFrom(page, '30', 'Dinner')
    await page.keyboard.type('amex')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect
      .poll(() => page.locator(`${WRITE} #to-error`).innerText())
      .toBe('Money coming in goes into one of your accounts. Pick one in To.')
    expect(await page.getAttribute(`${WRITE} input[name=to]`, 'aria-invalid')).toBe('true')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('to')
    expect(await rows(page)).toEqual([])
  })

  test('a bank account kept to USD pays in USD', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'chequing', 'bank', 'USD')

    await upToFrom(page, '5', 'Gum')
    await page.keyboard.type('chequing')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toEqual([`${today()} | Gum | 5.00 USD`])
  })
})

describe('leaving it alone', () => {
  test('the first spend, before any account, comes out of the wallet', async () => {
    const { page } = await launch(aHome())
    expect(await from(page)).toBe('')
    expect(await page.getAttribute(FROM, 'placeholder')).toBe('cash')

    await writeDown(page, '4.50', 'Coffee')

    await expect.poll(() => rows(page)).toHaveLength(1)
    expect(await paidFrom(page)).toBe('cash')
    await expect.poll(() => from(page)).toBe('cash')
  })

  test('the account used last is assumed, and still is after the app starts again', async () => {
    const home = aHome()
    const first = await launch(home)
    await addAccount(first.page, 'visa', 'card')
    await upToFrom(first.page, '30', 'Dinner')
    await first.page.keyboard.type('visa')
    await first.page.keyboard.press('Enter')
    await first.page.keyboard.press('Enter')
    await expect.poll(() => rows(first.page)).toHaveLength(1)
    expect(await from(first.page)).toBe('visa')

    await writeDown(first.page, '4.50', 'Coffee')
    await expect.poll(() => rows(first.page)).toHaveLength(2)
    expect(await paidFrom(first.page)).toBe('visa')
    await first.quit()

    const again = await launch(home)
    await expect.poll(() => from(again.page)).toBe('visa')
  })

  test('emptied, it means the account used last', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'visa', 'card')
    await upToFrom(page, '30', 'Dinner')
    await page.keyboard.type('visa')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await upToFrom(page, '4.50', 'Coffee')
    expect(await page.getAttribute(FROM, 'placeholder')).toBe('visa')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(2)
    expect(await paidFrom(page)).toBe('visa')
  })
})
