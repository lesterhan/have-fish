// Writing down money coming in, from the spend form: Entry-8's acceptance, with real keys.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  ADD_ACCOUNT,
  aHome,
  fromLine,
  launch,
  offeredPaths,
  openChip,
  openComposer,
  openSelected,
  PANE,
  rows,
  WRITE,
} from './app'

const NAV = 'nav[aria-label=Places]'
const ADDING = 'section[aria-label="The account"] form[aria-label="Add an account"]'
const FROM = `${WRITE} input[name=from]`
const OPTIONS = `${WRITE} [role=listbox][aria-label="Your accounts and income"]`

async function addAccount(page: Page, name: string, kind: string, start = '') {
  await page.click(`${NAV} button:has-text("Accounts")`)
  await page.click(ADD_ACCOUNT)
  await page.fill(`${ADDING} input[name=name]`, name)
  await page.selectOption(`${ADDING} select[name=kind]`, kind)
  await page.selectOption(`${ADDING} select[name=currency]`, 'CAD')
  if (start !== '') {
    await page.click(`${ADDING} details summary`)
    await page.fill(`${ADDING} input[name=start]`, start)
  }
  await page.locator(`${ADDING} input[name=name]`).press('Enter')
  await page.waitForSelector(`ol[aria-label=Accounts] li:has-text("${name}")`)
  await page.click(`${NAV} button:has-text("Ledger")`)
}

/** Amount, what for and To typed; the cursor in From, emptied. */
async function upToFrom(page: Page, amount: string, description: string, to: string) {
  await openComposer(page)
  await page.fill(`${WRITE} input[name=amount]`, amount)
  await page.fill(`${WRITE} input[name=description]`, description)
  await page.fill(`${WRITE} input[name=to]`, to)
  await page.locator(FROM).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  if (!(await page.isVisible(OPTIONS))) await page.press(FROM, 'ArrowDown')
}

const offered = (page: Page) => offeredPaths(page.locator(`${OPTIONS} [role=option]`))
const balances = async (page: Page) => {
  await page.click(`${NAV} button:has-text("Accounts")`)
  const listed = await page
    .locator('ol[aria-label=Accounts] li')
    .evaluateAll((items) =>
      items.map((li) =>
        [...li.querySelectorAll('[data-cell]')].map((c) => c.textContent?.trim() ?? '').join(' | '),
      ),
    )
  await page.click(`${NAV} button:has-text("Ledger")`)
  return listed
}

describe('write down money coming in', () => {
  test('2000 into chequing from salary: chequing goes up 2000, and it isn’t spending', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'chequing', 'bank', '100')

    await upToFrom(page, '2000', 'Pay', 'chequing')
    await page.keyboard.type('salary')
    await expect.poll(() => offered(page)).toEqual(['income:salary'])
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(2)
    expect((await rows(page))[0]).toMatch(/\| Pay \| \+2,000\.00$/)
    await openSelected(page)
    expect((await fromLine(page).textContent())?.replace(/\s+/g, ' ').trim()).toBe('income salary')
    await openChip(page, 'to')
    expect(await page.inputValue(`${PANE} input[name=to]`)).toBe('chequing')
    expect(await balances(page)).toEqual(['chequing | 2,100.00'])

    await page.click(`${NAV} button:has-text("Reports")`)
    await expect
      .poll(() => page.innerText('role=main'))
      .toContain('No spending in this week or the week before.')
  })

  test('a source used once is offered after my accounts, said as income', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'chequing', 'bank')
    await upToFrom(page, '50', 'Gift', 'chequing')
    await page.keyboard.type('gifts')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await upToFrom(page, '20', 'Birthday', 'chequing')
    await expect.poll(() => offered(page)).toEqual(['assets:chequing', 'income:gifts'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(2)
    expect(await balances(page)).toEqual(['chequing | 70.00'])
  })

  test('the next spend still comes out of the account used last, not the income source', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'chequing', 'bank', '100')
    await addAccount(page, 'visa', 'card')
    await upToFrom(page, '12', 'Lunch', 'food')
    await page.keyboard.type('visa')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(() => rows(page)).toHaveLength(2)

    await upToFrom(page, '2000', 'Pay', 'chequing')
    await page.keyboard.type('salary')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect.poll(() => rows(page)).toHaveLength(3)

    await openComposer(page)
    expect(await page.inputValue(FROM)).toBe('visa')
  })

  test('from an income source to a category: refused on To, and nothing is written', async () => {
    const { page } = await launch(aHome())
    await addAccount(page, 'chequing', 'bank')
    await upToFrom(page, '2000', 'Pay', 'food')
    await page.keyboard.type('salary')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    await expect
      .poll(() => page.locator(`${WRITE} [role=alert]`).innerText())
      .toBe('not an account')
    expect(await rows(page)).toEqual([])
  })
})
