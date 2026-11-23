// What foreign money I started with cost: its acceptance, with real keys.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  ADD_ACCOUNT,
  ADDING,
  accountLines,
  aHome,
  chip,
  focusedName,
  goTo,
  launch,
  openChip,
  openSelected,
  PANE,
  shownDay,
} from './app'

const ACCOUNT = 'section[aria-label="The account"]'
const QUESTION = `${ACCOUNT} details summary`
const LIST = 'ol[aria-label=Accounts]'
const COST_FORM = `${ACCOUNT} form[aria-label="What it cost"]`
const today = () => new Date().toLocaleDateString('en-CA')

/** What the selected account's pane says, its starting balance among it. */
const started = (page: Page) =>
  page
    .locator(ACCOUNT)
    .innerText()
    .then((t) => t.replace(/\s+/g, ' ').trim())

/** Opens the question, and waits for the cursor to land in the amount. */
async function ask(page: Page) {
  await page.click(QUESTION)
  await expect.poll(() => focusedName(page)).toBe('start')
}

/**
 * A name, a kind, maybe a currency, and a start typed in the opened question; then Tab to what it
 * cost, typed unless `cost` is undefined; then Enter.
 */
async function add(
  page: Page,
  name: string,
  kind: string,
  currency: string | undefined,
  start: string,
  cost?: string,
) {
  await page.click(ADD_ACCOUNT)
  await page.fill(`${ADDING} input[name=name]`, name)
  await page.selectOption(`${ADDING} select[name=kind]`, kind)
  if (currency !== undefined) await page.selectOption(`${ADDING} select[name=currency]`, currency)
  await ask(page)
  await page.keyboard.type(start)
  await page.keyboard.press('Tab')
  await expect.poll(() => focusedName(page)).toBe('cost')
  if (cost !== undefined) await page.keyboard.type(cost)
  await page.keyboard.press('Enter')
}

describe('a start in another currency, when adding', () => {
  test('asks what it cost, with CAD beside it', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')
    await page.click(ADD_ACCOUNT)
    await page.selectOption(`${ADDING} select[name=currency]`, 'EUR')
    await ask(page)

    await expect.poll(() => page.locator(`${ADDING} input[name=cost]`).count()).toBe(1)
    expect(
      await page
        .locator(`${ADDING} input[name=cost]`)
        .evaluate((el) => el.nextElementSibling?.textContent?.trim()),
    ).toBe('CAD')
  })

  test('a start in the home currency asks nothing for a cost', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')
    await page.click(ADD_ACCOUNT)
    await page.selectOption(`${ADDING} select[name=kind]`, 'bank')
    await ask(page)

    expect(await page.locator(`${ADDING} input[name=cost]`).count()).toBe(0)
  })

  test('typed and sent: the account started with 200.00 euros, today', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')

    await add(page, 'wise:eur', 'bank', 'EUR', '200', '300')

    await expect.poll(() => started(page)).toContain(`Started with 200.00 EUR ${shownDay(today())}`)
  })

  test('the pane says what it cost, and the rate', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')

    await add(page, 'wise:eur', 'bank', 'EUR', '200', '300')

    await expect
      .poll(() => page.locator('#account-cost-said').innerText())
      .toBe('300.00 CAD at 1 CAD = 0.6667 EUR')
  })

  test('the Accounts list holds the 200.00 euros, under wise', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')

    await add(page, 'wise:eur', 'bank', 'EUR', '200', '300')

    await expect
      .poll(async () => (await accountLines(page)).find((line) => line.startsWith(':eur')))
      .toContain(':eur | 200.00 EUR')
  })

  test('a cost left empty: the start is saved, and the form asks what it cost', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')

    await add(page, 'wise:eur', 'bank', 'EUR', '200')

    await expect.poll(() => started(page)).toContain('Started with 200.00 EUR')
    expect(await page.locator('#account-cost-said').count()).toBe(0)
    await expect.poll(() => page.locator(`${COST_FORM} input[name=cost]`).count()).toBe(1)
  })

  test('the cost said in that form: the pane says it, and the form goes', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')
    await add(page, 'wise:eur', 'bank', 'EUR', '200')

    await page.fill(`${COST_FORM} input[name=cost]`, '300')
    await page.keyboard.press('Enter')

    await expect
      .poll(() => page.locator('#account-cost-said').innerText())
      .toBe('300.00 CAD at 1 CAD = 0.6667 EUR')
    await expect.poll(() => page.locator(COST_FORM).count()).toBe(0)
  })

  test('Ctrl+Z takes the cost back, and the form comes back', async () => {
    const { page, press } = await launch(aHome())
    await goTo(page, 'Accounts')
    await add(page, 'wise:eur', 'bank', 'EUR', '200')
    await page.fill(`${COST_FORM} input[name=cost]`, '300')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('#account-cost-said').count()).toBe(1)

    press('ctrl+z')

    await expect.poll(() => page.locator('#account-cost-said').count()).toBe(0)
    await expect.poll(() => page.locator(`${COST_FORM} input[name=cost]`).count()).toBe(1)
  })

  test('a cost that is not an amount: nothing is saved, and the field says why', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')

    await add(page, 'wise:eur', 'bank', 'EUR', '200', 'lots')

    await expect
      .poll(() => page.locator('#account-cost-error').innerText())
      .toBe('Type what it cost you, as an amount above zero.')
    expect(await page.getAttribute(`${ADDING} input[name=cost]`, 'aria-invalid')).toBe('true')
    await expect.poll(() => focusedName(page)).toBe('cost')
    expect(await page.locator(`${LIST} li`).count()).toBe(0)
  })

  test('a card kept to EUR: the same, as what I owe', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')

    await add(page, 'visa:eur', 'card', 'EUR', '200', '300')

    await expect.poll(() => started(page)).toContain('Owed at the start 200.00 EUR')
    await expect
      .poll(() => page.locator('#account-cost-said').innerText())
      .toBe('300.00 CAD at 1 CAD = 0.6667 EUR')
  })

  test('the Ledger locks its amount, and its description still opens', async () => {
    const { page } = await launch(aHome())
    await goTo(page, 'Accounts')
    await add(page, 'wise:eur', 'bank', 'EUR', '200', '300')

    await goTo(page, 'Ledger')
    await openSelected(page)

    await expect.poll(() => page.locator(chip('amount')).isDisabled()).toBe(true)
    await openChip(page, 'description')
    await expect.poll(() => page.locator(`${PANE} input[name=description]`).count()).toBe(1)
  })
})
