// Saying how much is in an account today: Entry-14's acceptance, with real keys.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { ADD_ACCOUNT, aHome, launch, rows, writeDown } from './app'

const NAV = 'nav[aria-label=Places]'
const LIST = 'ol[aria-label=Accounts]'
const ACCOUNT = 'section[aria-label="The account"]'
const ADDING = `${ACCOUNT} form[aria-label="Add an account"]`
const QUESTION = `${ACCOUNT} details summary`
const START = `${ACCOUNT} input[name=start]`

const today = () => new Date().toLocaleDateString('en-CA')

/** A name, a kind, and maybe what's in it today, typed in the opened question; then Enter. */
async function add(page: Page, name: string, kind: string, start?: string) {
  await page.click(ADD_ACCOUNT)
  await page.fill(`${ADDING} input[name=name]`, name)
  await page.selectOption(`${ADDING} select[name=kind]`, kind)
  if (start !== undefined) {
    await page.click(QUESTION)
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('name')))
      .toBe('start')
    await page.keyboard.type(start)
  }
  await page.keyboard.press('Enter')
}

/** Opens the question and waits for the cursor to land in it. */
async function ask(page: Page) {
  await page.click(QUESTION)
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('name')))
    .toBe('start')
}

/** The selected account's starting balance, as its pane says it. */
const started = (page: Page) =>
  page
    .locator(`${ACCOUNT} dl`)
    .innerText()
    .then((t) => t.replace(/\s+/g, ' ').trim())

async function toAccounts(page: Page) {
  await page.click(`${NAV} button:has-text("Accounts")`)
}

describe('a starting balance, said when adding', () => {
  test('1,234.56 in a bank account: it has that from today', async () => {
    const { page } = await launch(aHome())
    await toAccounts(page)

    await add(page, 'chequing', 'bank', '1,234.56')

    await expect.poll(() => started(page)).toContain(`Started with 1234.56 CAD ${today()}`)
    await page.click(`${NAV} button:has-text("Spends")`)
    await expect.poll(() => rows(page)).toEqual([`${today()} | Starting balance | 1234.56 CAD`])
  })

  test('on a card or a loan, it asks what I owe, and shows it as owed', async () => {
    const { page } = await launch(aHome())
    await toAccounts(page)
    await page.click(ADD_ACCOUNT)
    await page.selectOption(`${ADDING} select[name=kind]`, 'card')
    expect(await page.locator(QUESTION).innerText()).toBe('How much do you owe on it today?')
    await page.selectOption(`${ADDING} select[name=kind]`, 'bank')
    expect(await page.locator(QUESTION).innerText()).toBe('How much is in it today?')
    await page.keyboard.press('Escape')

    await add(page, 'visa', 'card', '500')

    await expect.poll(() => started(page)).toContain(`Owed at the start 500.00 CAD ${today()}`)
  })

  test('the question opens from the keyboard, with the cursor in it', async () => {
    const { page } = await launch(aHome())
    await toAccounts(page)
    await page.click(ADD_ACCOUNT)

    await page.locator(QUESTION).focus()
    await page.keyboard.press('Enter')

    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('name')))
      .toBe('start')
  })

  test('skipped, the account is added with nothing in it', async () => {
    const { page } = await launch(aHome())
    await toAccounts(page)

    await add(page, 'chequing', 'bank')

    await expect.poll(() => page.locator(`${LIST} li`).count()).toBe(1)
    expect(await started(page)).not.toContain('Started with')
    expect(await page.locator(QUESTION).innerText()).toBe('How much is in it today?')
    await page.click(`${NAV} button:has-text("Spends")`)
    expect(await rows(page)).toEqual([])
  })

  test('typed, then folded away again, is skipped too', async () => {
    const { page } = await launch(aHome())
    await toAccounts(page)
    await page.click(ADD_ACCOUNT)
    await page.fill(`${ADDING} input[name=name]`, 'chequing')
    await page.click(QUESTION)
    await page.keyboard.type('100')
    await page.click(QUESTION)

    await page.locator(`${ADDING} input[name=name]`).press('Enter')

    await expect.poll(() => page.locator(`${LIST} li`).count()).toBe(1)
    expect(await started(page)).not.toContain('Started with')
  })

  test('something that isn’t an amount: nothing is saved, and the field says why', async () => {
    const { page } = await launch(aHome())
    await toAccounts(page)

    await add(page, 'chequing', 'bank', 'lots')

    await expect
      .poll(() => page.locator(`${ACCOUNT} #account-start-error`).innerText())
      .toBe("That isn't an amount. Type a number, like 4.50.")
    expect(await page.getAttribute(START, 'aria-invalid')).toBe('true')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('start')
    expect(await page.locator(`${LIST} li`).count()).toBe(0)
  })

  test('an amount sent before the question has said it opened is still kept', async () => {
    const { page } = await launch(aHome())
    await toAccounts(page)
    await page.click(ADD_ACCOUNT)
    await page.fill(`${ADDING} input[name=name]`, 'chequing')

    // One task: open, type, send. The details element's toggle event comes after it (#592).
    await page.evaluate(
      ({ question, start, form }) => {
        document.querySelector<HTMLElement>(question)?.click()
        const field = document.querySelector<HTMLInputElement>(start)
        if (field === null) throw new Error('no start field')
        field.value = '100'
        field.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector<HTMLFormElement>(form)?.requestSubmit()
      },
      { question: QUESTION, start: START, form: ADDING },
    )

    await expect.poll(() => page.locator(`${LIST} li`).allInnerTexts()).toHaveLength(1)
    await expect.poll(() => started(page)).toContain('100.00 CAD')
  })

  test('the list refreshing while I add leaves what I typed alone', async () => {
    const { page } = await launch(aHome())
    await toAccounts(page)
    await add(page, 'cash', 'cash')
    await expect.poll(() => page.locator(`${LIST} li`).count()).toBe(1)

    await page.click(ADD_ACCOUNT)
    await page.fill(`${ADDING} input[name=name]`, 'chequing')
    await ask(page)
    await page.keyboard.type('250')
    // A change from elsewhere: the list asks for the accounts again, and cash comes back anew.
    await page.evaluate(() =>
      window.haveFish.invoke('spend.write', { amount: '1', description: '' }),
    )
    await expect
      .poll(() => page.locator(`${LIST} li`).allInnerTexts())
      .toEqual([expect.stringContaining('-1.00 CAD')])

    expect(await page.inputValue(START)).toBe('250')
    await page.keyboard.press('Enter')
    await expect
      .poll(() => page.locator(`${LIST} li:has-text("chequing")`).innerText())
      .toContain('250.00 CAD')
  })

  test('Ctrl+Z takes back the account and its balance together', async () => {
    const { page, press } = await launch(aHome())
    await toAccounts(page)
    await add(page, 'chequing', 'bank', '10')
    await expect.poll(() => page.locator(`${LIST} li`).count()).toBe(1)

    press('ctrl+z')

    await expect.poll(() => page.locator(`${LIST} li`).count()).toBe(0)
    await page.click(`${NAV} button:has-text("Spends")`)
    expect(await rows(page)).toEqual([])
  })
})

describe('a starting balance for an account I already have', () => {
  test('the wallet the app made can be given one', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await toAccounts(page)
    await page.click(`${LIST} li:has-text("cash")`)

    await ask(page)
    await page.keyboard.type('20')
    await page.keyboard.press('Enter')

    await expect.poll(() => started(page)).toContain(`Started with 20.00 CAD ${today()}`)
    expect(await page.isVisible(QUESTION)).toBe(false)
  })

  test('not an amount is refused there too', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await toAccounts(page)
    await page.click(`${LIST} li:has-text("cash")`)

    await ask(page)
    await page.keyboard.type('4,50')
    await page.keyboard.press('Enter')

    await expect
      .poll(() => page.locator(`${ACCOUNT} #account-start-error`).innerText())
      .toBe("That isn't an amount. Type a number, like 4.50.")
    expect(await started(page)).not.toContain('Started with')
  })
})
