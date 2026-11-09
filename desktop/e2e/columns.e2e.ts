// A ledger row's columns fit the list they're in: at the size the window opens, with the pane
// beside the list, To and the description each read a word, in the ledger and in Reports. The
// headings sit over their columns.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, openComposer, rows, WRITE } from './app'
import { seed } from './month'

const NAV = 'nav[aria-label=Places]'
const LEDGER = 'ol[aria-label=Ledger]'
const ACCOUNTS = 'ol[aria-label=Accounts]'
const BREAKDOWN = 'ol[aria-label="Spending by category"]'
const BEHIND = 'ol[aria-label="Its spends"]'
const ADD_ACCOUNT = 'role=button[name="Add account"s]'
const ADDING = 'section[aria-label="The account"] form[aria-label="Add an account"]'

/** Add account with a name and a kind, Enter: as a person does it, at the size the window opens. */
async function addAccount(page: Page, name: string, kind: string) {
  await page.click(ADD_ACCOUNT)
  await page.locator(`${ADDING} input[name=name]`).focus()
  await page.keyboard.type(name)
  await page.selectOption(`${ADDING} select[name=kind]`, kind)
  await page.locator(`${ADDING} input[name=name]`).focus()
  await page.keyboard.press('Enter')
}

/** About a short word at the base size: more than the two letters the row once left. */
const A_WORD = 64

async function spend(page: Page, amount: string, description: string, to: string) {
  const before = (await rows(page)).length
  await openComposer(page)
  await page.fill(`${WRITE} input[name=amount]`, amount)
  await page.fill(`${WRITE} input[name=description]`, description)
  await page.fill(`${WRITE} input[name=to]`, to)
  await page.press(`${WRITE} input[name=amount]`, 'Enter')
  await expect.poll(async () => (await rows(page)).length).toBe(before + 1)
}

/** The first row's cells in a list, by name, each with its width and edges. */
const cellsIn = (page: Page, list: string) =>
  page.evaluate((list) => {
    const row = document.querySelector(`${list} [role=option]`)
    return Object.fromEntries(
      [...(row?.querySelectorAll<HTMLElement>('[data-cell]') ?? [])].map((cell) => {
        const { left, right, width } = cell.getBoundingClientRect()
        return [cell.dataset.cell, { left, right, width }]
      }),
    )
  }, list)

/** The headings over a list, each with its edges. */
const headingsOver = (page: Page, list: string) =>
  page.evaluate((list) => {
    // The list's own block holds the headings, then maybe the composer, then the scroller.
    const headings = document.querySelector(list)?.parentElement?.parentElement?.firstElementChild
    return [...(headings?.children ?? [])].map((h) => {
      const { left, right } = h.getBoundingClientRect()
      return { name: h.textContent, left, right }
    })
  }, list)

describe("a row's columns", () => {
  test('at the size the window opens, To and the description each read a word', async () => {
    const { page } = await launch(aHome())
    await spend(page, '42.10', 'Groceries for the week', 'food')
    await page.waitForSelector(`${LEDGER} [data-cell=to]`)
    expect(await page.evaluate(() => innerWidth)).toBe(960)

    const ledger = await cellsIn(page, LEDGER)
    // With the form gone the list has the width at 960, so From leads as it does wide.
    expect(Object.keys(ledger), 'the ledger at 960').toContain('from')
    expect(ledger.to?.width).toBeGreaterThanOrEqual(A_WORD)
    expect(ledger.description?.width).toBeGreaterThanOrEqual(A_WORD)
    // A path says its root's word, which the tag stands for, as a screen reader hears it.
    const to = await page.locator(`${LEDGER} [data-cell=to]`).first().textContent()
    expect(to?.replace(/\s+/g, ' ').trim()).toBe('expenses food')

    // Reports' spends sit in half its place, and narrow the same way.
    await page.click(`${NAV} button:has-text("Reports")`)
    await page.click(`${BREAKDOWN} li:has-text("food")`)
    await page.waitForSelector(`${BEHIND} [data-cell=to]`)
    const reported = await cellsIn(page, BEHIND)
    expect(Object.keys(reported), 'From goes in a narrow list').not.toContain('from')
    expect(reported.to?.width).toBeGreaterThanOrEqual(A_WORD)
    expect(reported.description?.width).toBeGreaterThanOrEqual(A_WORD)
  })

  test('at the size the window opens, each account name reads whole and the headings stand apart', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await addAccount(page, 'tangerine:chequing', 'bank')
    await addAccount(page, 'vacationfund', 'cash')
    await addAccount(page, 'visa', 'card')
    await page.waitForSelector(`${ACCOUNTS} [data-cell=name]`)
    expect(await page.evaluate(() => innerWidth)).toBe(960)

    // Kind goes before a name does: the pane already says it.
    const headings = await headingsOver(page, ACCOUNTS)
    expect(headings.map((h) => h.name)).toEqual(['Account', 'Balance'])

    // tangerine, :chequing, vacationfund, visa: each whole, none cut off with an ellipsis.
    const cut = await page.evaluate(
      (list) =>
        [...document.querySelectorAll<HTMLElement>(`${list} [data-cell=name]`)].map(
          (cell) => cell.scrollWidth > cell.clientWidth + 1,
        ),
      ACCOUNTS,
    )
    expect(cut).toEqual([false, false, false, false])
  })

  test('a wide list leads with From, and the headings sit over their columns', {
    timeout: 120_000,
  }, async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 800 })
    // A month, so the list scrolls and its scrollbar takes room the headings must keep too.
    await seed(page)
    if (await page.isVisible('form[aria-label="Write down a spend"]')) {
      await page.keyboard.press('Escape')
    }
    await page.waitForSelector(`${LEDGER} [data-cell=from]`)
    await page.waitForFunction(() => document.getAnimations().length === 0)
    const scrolls = await page
      .locator(LEDGER)
      .evaluate(
        (list) => (list.parentElement?.scrollHeight ?? 0) > (list.parentElement?.clientHeight ?? 0),
      )
    expect(scrolls).toBe(true)

    const cells = await cellsIn(page, LEDGER)
    const headings = await headingsOver(page, LEDGER)
    expect(headings.map((h) => h.name)).toEqual(['From', 'Amount', 'To', 'Description'])
    const [from, amount, to, description] = headings
    expect(from?.left).toBeCloseTo(cells.from?.left ?? 0, 0)
    // Over figures that align to their end, Amount does too.
    expect(amount?.right).toBeCloseTo(cells.amount?.right ?? 0, 0)
    expect(to?.left).toBeCloseTo(cells.to?.left ?? 0, 0)
    expect(description?.left).toBeCloseTo(cells.description?.left ?? 0, 0)
  })
})
