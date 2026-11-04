// Seeing how much is in each account, in the built app.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, rows, WRITE } from './app'

const NAV = 'nav[aria-label=Places]'
const LIST = 'ol[aria-label=Accounts]'
const ADDING = 'section[aria-label="The account"] form[aria-label="Add an account"]'

/** Adds an account on the Accounts place, with what's in it or owed on it today if given. */
async function addAccount(
  page: Page,
  name: string,
  kind: string,
  currency?: string,
  start?: string,
) {
  await page.click(`${NAV} button:has-text("Accounts")`)
  await page.click('main.accounts button.add')
  await page.fill(`${ADDING} input[name=name]`, name)
  await page.selectOption(`${ADDING} select[name=kind]`, kind)
  if (currency !== undefined) await page.selectOption(`${ADDING} select[name=currency]`, currency)
  if (start !== undefined) {
    await page.click(`${ADDING} details summary`)
    await page.fill(`${ADDING} input[name=start]`, start)
  }
  await page.locator(`${ADDING} input[name=name]`).press('Enter')
  await page.waitForSelector(`${LIST} li[data-id]:has-text("${name.split(':').at(-1)}")`)
}

/** A spend written from one account to a category or another account, by name. */
async function spend(page: Page, amount: string, from: string, to = '') {
  await page.click(`${NAV} button:has-text("Spends")`)
  const before = (await rows(page)).length
  await page.fill(`${WRITE} input[name=amount]`, amount)
  await page.fill(`${WRITE} input[name=to]`, to)
  await page.fill(`${WRITE} input[name=from]`, from)
  await page.press(`${WRITE} input[name=amount]`, 'Enter')
  await expect.poll(async () => (await rows(page)).length).toBe(before + 1)
}

/** The accounts list as text: name, kind, currency, balance. */
const listed = (page: Page) =>
  page
    .locator(`${LIST} li`)
    .evaluateAll((items) =>
      items.map((li) => [...li.children].map((c) => c.textContent?.trim() ?? '').join(' | ')),
    )

const toAccounts = (page: Page) => page.click(`${NAV} button:has-text("Accounts")`)

describe('see how much is in each account', () => {
  test('spends and transfers: each balance is what came in minus what went out', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'chequing', 'bank', 'CAD', '1000')
    await addAccount(page, 'cash', 'cash')

    await spend(page, '50', 'chequing')
    await spend(page, '100', 'chequing', 'cash')
    await spend(page, '4.50', 'cash')
    await toAccounts(page)

    await expect
      .poll(() => listed(page))
      .toEqual([
        'cash | Cash | Any currency | 95.50 CAD',
        'chequing | Bank account | CAD | 850.00 CAD',
      ])
  })

  test('a card shows what I owe on it, and paying it down lowers that', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'chequing', 'bank', 'CAD', '500')
    await addAccount(page, 'visa', 'card', 'CAD', '200')

    await spend(page, '30', 'visa')
    await toAccounts(page)
    await expect.poll(() => listed(page)).toContain('visa | Card | CAD | owed 230.00 CAD')

    await spend(page, '100', 'chequing', 'visa')
    await toAccounts(page)
    await expect
      .poll(() => listed(page))
      .toEqual([
        'chequing | Bank account | CAD | 400.00 CAD',
        'visa | Card | CAD | owed 130.00 CAD',
      ])
  })

  test('an account with nothing in it shows zero', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'savings', 'bank', 'USD')
    expect(await listed(page)).toEqual(['savings | Bank account | USD | 0.00 USD'])
  })

  test('a parent shows its children’s money per currency, and the arrows pass over it', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'wise:cad', 'bank', 'CAD', '100')
    await addAccount(page, 'wise:eur', 'bank', 'EUR', '50')

    await expect
      .poll(() => listed(page))
      .toEqual([
        'wise |  |  | 100.00 CAD · 50.00 EUR',
        'cad | Bank account | CAD | 100.00 CAD',
        'eur | Bank account | EUR | 50.00 EUR',
      ])
    const selected = () => page.locator(`${LIST} li[aria-selected=true] .name`).allTextContents()
    expect(await page.getAttribute(`${LIST} li:first-child`, 'aria-disabled')).toBe('true')

    await page.locator(LIST).focus()
    await page.keyboard.press('Home')
    expect(await selected()).toEqual(['cad'])
    await page.keyboard.press('ArrowDown')
    expect(await selected()).toEqual(['eur'])
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    expect(await selected()).toEqual(['cad'])
    await page.click(`${LIST} li:first-child`, { force: true })
    expect(await selected()).toEqual(['cad'])
  })

  test('a spend taken back with Ctrl+Z gives its money back', async () => {
    const { page, press } = await launch(aHome())
    await addAccount(page, 'chequing', 'bank', 'CAD', '100')
    await spend(page, '40', 'chequing')
    await toAccounts(page)
    await expect.poll(() => listed(page)).toEqual(['chequing | Bank account | CAD | 60.00 CAD'])

    await page.click(`${NAV} button:has-text("Spends")`)
    await page.locator('ol[aria-label=Spends]').focus()
    press('ctrl+z')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await toAccounts(page)

    await expect.poll(() => listed(page)).toEqual(['chequing | Bank account | CAD | 100.00 CAD'])
  })
})
