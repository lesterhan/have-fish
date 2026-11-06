// A ledger row's columns fit the list they're in: at the size the window opens, with the pane
// beside the list, To and the description each read a word, in the ledger and in Reports. The
// headings sit over their columns.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, rows, WRITE } from './app'
import { seed } from './month'

const NAV = 'nav[aria-label=Places]'
const LEDGER = 'ol[aria-label=Ledger]'
const BREAKDOWN = 'ol[aria-label="Spending by category"]'
const BEHIND = 'ol[aria-label="Its spends"]'

/** About a short word at the base size: more than the two letters the row once left. */
const A_WORD = 64

async function spend(page: Page, amount: string, description: string, to: string) {
  const before = (await rows(page)).length
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
    const headings = document.querySelector(list)?.previousElementSibling
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
    expect(Object.keys(ledger), 'From goes in a narrow list').not.toContain('from')
    expect(ledger.to?.width).toBeGreaterThanOrEqual(A_WORD)
    expect(ledger.description?.width).toBeGreaterThanOrEqual(A_WORD)

    // Reports' spends sit in half its place, and narrow the same way.
    await page.click(`${NAV} button:has-text("Reports")`)
    await page.click(`${BREAKDOWN} li:has-text("food")`)
    await page.waitForSelector(`${BEHIND} [data-cell=to]`)
    const reported = await cellsIn(page, BEHIND)
    expect(reported.to?.width).toBeGreaterThanOrEqual(A_WORD)
    expect(reported.description?.width).toBeGreaterThanOrEqual(A_WORD)
  })

  test('a wide list leads with From, and the headings sit over their columns', {
    timeout: 120_000,
  }, async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 800 })
    // A month, so the list scrolls and its scrollbar takes room the headings must keep too.
    await seed(page)
    await page.waitForSelector(`${LEDGER} [data-cell=from]`)
    await page.waitForFunction(() => document.getAnimations().length === 0)
    const scrolls = await page
      .locator(LEDGER)
      .evaluate((list) => list.scrollHeight > list.clientHeight)
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
