// Moving money between my own accounts: Entry-5's acceptance, with real keys.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { ADD_ACCOUNT, aHome, fromLine, launch, PANE, rows, shownDay, WRITE, writeDown } from './app'

const NAV = 'nav[aria-label=Places]'
const ADDING = 'section[aria-label="The account"] form[aria-label="Add an account"]'
const TO = `${WRITE} input[name=to]`
const OPTIONS = `${WRITE} [role=listbox][aria-label="Your categories and accounts"]`
const PANE_TO = `${PANE} input[name=to]`

const today = () => new Date().toLocaleDateString('en-CA')

/** Adds an account on the Accounts place, then comes back to the ledger. */
async function addAccount(page: Page, name: string, kind: string) {
  await page.click(`${NAV} button:has-text("Accounts")`)
  await page.click(ADD_ACCOUNT)
  await page.fill(`${ADDING} input[name=name]`, name)
  await page.selectOption(`${ADDING} select[name=kind]`, kind)
  await page.locator(`${ADDING} input[name=name]`).press('Enter')
  await page.waitForSelector(`ol[aria-label=Accounts] li:has-text("${name}")`)
  await page.click(`${NAV} button:has-text("Ledger")`)
}

/** The wallet, from a first spend, and a bank account. */
async function twoAccounts(page: Page) {
  await writeDown(page, '4.50', 'Coffee')
  await expect.poll(() => rows(page)).toHaveLength(1)
  await addAccount(page, 'chequing', 'bank')
}

/** Amount, Tab, what for, Tab: the cursor in To. */
async function upToTo(page: Page, amount: string, description: string) {
  await page.locator(`${WRITE} input[name=amount]`).focus()
  await page.keyboard.type(amount)
  await page.keyboard.press('Tab')
  await page.keyboard.type(description)
  await page.keyboard.press('Tab')
}

/** Tab on from To, and From emptied, then `name` typed and picked. */
async function fromIs(page: Page, name: string) {
  await page.keyboard.press('Tab')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
}

const offered = (page: Page) =>
  page.locator(`${OPTIONS} [role=option]`).evaluateAll((options) =>
    options.map((o) =>
      [...o.querySelectorAll('span')]
        .map((s) => s.textContent)
        .filter((t) => t !== '')
        .join(' · '),
    ),
  )
const paidFrom = (page: Page) =>
  fromLine(page)
    .innerText()
    .then((t) => t.replace(/^From\s+/, ''))

describe('moving money between my accounts', () => {
  test('100 from chequing to the wallet: To is the wallet, From is chequing', async () => {
    const { page } = await launch(aHome())
    await twoAccounts(page)

    await upToTo(page, '100', 'Cash out')
    await page.keyboard.type('cash')
    await page.keyboard.press('Enter')
    await fromIs(page, 'chequing')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(2)
    expect((await rows(page))[0]).toBe(`${shownDay(today())} | Cash out | ⇄ 100.00`)
    expect(await page.inputValue(PANE_TO)).toBe('cash')
    expect(await paidFrom(page)).toBe('chequing')
  })

  test('To offers the categories I use, then my accounts, each saying what it is', async () => {
    const { page } = await launch(aHome())
    await twoAccounts(page)
    await upToTo(page, '3', 'Muffin')
    await page.keyboard.type('cafe')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(() => rows(page)).toHaveLength(2)

    await upToTo(page, '1', 'Gum')
    await page.keyboard.type('c')

    await expect
      .poll(() => offered(page))
      .toEqual(['cafe', 'cash · Cash', 'chequing · Bank account', 'Create c'])
  })

  test('to the account it comes from: nothing is written, and To says why', async () => {
    const { page } = await launch(aHome())
    await twoAccounts(page)

    await upToTo(page, '20', 'Nowhere')
    await page.keyboard.type('cash')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect
      .poll(() => page.locator(`${WRITE} #to-error`).innerText())
      .toBe("That's the account it comes from.")
    expect(await page.getAttribute(TO, 'aria-invalid')).toBe('true')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('to')
    expect(await rows(page)).toHaveLength(1)
  })
})

describe('changing where it went, in the pane', () => {
  test('a spend becomes a transfer; changing only its amount after leaves it one', async () => {
    const { page, press } = await launch(aHome())
    await twoAccounts(page)

    await page.locator(PANE_TO).focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('cheq')
    await page.keyboard.press('Enter')
    expect(await page.inputValue(PANE_TO)).toBe('chequing')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await rows(page))[0]).not.toContain('●')

    await page.fill(`${PANE} input[name=amount]`, '5')
    await page.locator(`${PANE} input[name=amount]`).press('Enter')
    await expect
      .poll(async () => (await rows(page))[0])
      .toBe(`${shownDay(today())} | Coffee | ⇄ 5.00`)
    expect(await page.inputValue(PANE_TO)).toBe('chequing')

    await page.locator('ol[aria-label=Ledger]').focus()
    press('ctrl+z')
    press('ctrl+z')
    await expect.poll(() => page.inputValue(PANE_TO)).toBe('unsorted')
  })
})
