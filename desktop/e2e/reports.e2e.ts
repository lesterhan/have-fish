// Seeing what I spent this week, by category: Reports-1's acceptance, in the built app.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  ADD_ACCOUNT,
  aHome,
  cellsOf,
  launch,
  openChip,
  openComposer,
  openSpend,
  rows,
  spendCells,
  WRITE,
} from './app'

const NAV = 'nav[aria-label=Places]'
const BREAKDOWN = 'ol[aria-label="Spending by category"]'
const BEHIND = 'ol[aria-label="Its spends"]'
const PICKED = 'section[aria-label="The spend picked"]'
const TRAIL = 'nav[aria-label="Where you are in your categories"]'
const WEEK = '[role=group][aria-label="The week shown"]'
const ADDING = 'section[aria-label="The account"] form[aria-label="Add an account"]'

const DAY = 86_400_000
const here = Intl.DateTimeFormat().resolvedOptions().timeZone
const daysAgo = (n: number) => calendarDateAt(Date.now() - n * DAY, here)

/** A spend written in the ledger: amount, what for, To, and From and its day if given. */
async function spend(
  page: Page,
  amount: string,
  description: string,
  to: string,
  from = '',
  date = '',
) {
  await page.click(`${NAV} button:has-text("Ledger")`)
  const before = (await rows(page)).length
  await openComposer(page)
  await page.fill(`${WRITE} input[name=amount]`, amount)
  await page.fill(`${WRITE} input[name=description]`, description)
  await page.fill(`${WRITE} input[name=to]`, to)
  if (from !== '') await page.fill(`${WRITE} input[name=from]`, from)
  if (date !== '') await page.fill(`${WRITE} input[name=date]`, date)
  await page.press(`${WRITE} input[name=amount]`, 'Enter')
  await expect.poll(async () => (await rows(page)).length).toBe(before + 1)
}

async function addAccount(page: Page, name: string, kind: string) {
  await page.click(`${NAV} button:has-text("Accounts")`)
  await page.click(ADD_ACCOUNT)
  await page.fill(`${ADDING} input[name=name]`, name)
  await page.selectOption(`${ADDING} select[name=kind]`, kind)
  await page.locator(`${ADDING} input[name=name]`).press('Enter')
  await page.waitForSelector(`ol[aria-label=Accounts] li:has-text("${name}")`)
}

const toReports = (page: Page) => page.click(`${NAV} button:has-text("Reports")`)

/** The breakdown as text: name, the › for one that opens, amount; then the total. */
const breakdown = (page: Page) =>
  page.evaluate((list) => {
    const ol = document.querySelector(list)
    const lines = [...(ol?.querySelectorAll('li') ?? [])].map((li) =>
      [...li.children]
        .map((c) => c.textContent?.trim() ?? '')
        .filter((t) => t !== '')
        .join(' | '),
    )
    // Beside the list's scroller, which holds the listbox.
    const total = [...(ol?.parentElement?.parentElement?.querySelectorAll('p') ?? [])]
      .map((p) => p.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .find((t) => t.startsWith('Spent'))
    return [...lines, total?.trim() ?? '']
  }, BREAKDOWN)

/** Each bar's width, as a share of its track, rounded to a percent. */
const bars = (page: Page) =>
  page.locator(`${BREAKDOWN} [aria-hidden=true] > span`).evaluateAll((spans) =>
    spans.map((s) => {
      const track = s.parentElement?.getBoundingClientRect().width ?? 1
      return Math.round((s.getBoundingClientRect().width / track) * 100)
    }),
  )

/** What the list beside the breakdown shows: the spends' descriptions. */
const behind = (page: Page) =>
  spendCells(page.locator(`${BEHIND} li`)).then((rows) =>
    rows.map(([, description]) => description),
  )
const trail = (page: Page) => page.locator(TRAIL).innerText()

describe('see what I spent this week, by category', () => {
  test('each category its total and share, unsorted its own line, and transfers left out', async () => {
    const { page, press } = await launch(aHome())
    await spend(page, '60', 'Groceries', 'food')
    await spend(page, '30', 'Bus pass', 'transport')
    await spend(page, '10', 'Something', '')
    await addAccount(page, 'chequing', 'bank')
    await spend(page, '500', 'Cash out', 'cash', 'chequing')

    press('ctrl+3')
    await expect
      .poll(() => breakdown(page))
      .toEqual(['food | 60.00', 'transport | 30.00', 'Unsorted | 10.00', 'Spent 100.00'])
    expect(await bars(page)).toEqual([60, 30, 10])
    expect(await page.innerText(WEEK)).toContain('This week')
    expect(await behind(page)).toEqual(['Something', 'Bus pass', 'Groceries'])
  })

  test('a category with ones under it opens, with a trail back out', async () => {
    const { page } = await launch(aHome())
    await spend(page, '4.50', 'Coffee', 'food:coffee')
    await spend(page, '50', 'Groceries', 'food:groceries')
    await spend(page, '5.50', 'Snack', 'food')
    await spend(page, '20', 'Movie', 'fun')
    await toReports(page)

    await expect
      .poll(() => breakdown(page))
      .toEqual(['food | › | 60.00', 'fun | 20.00', 'Spent 80.00'])
    await page.click(`${BREAKDOWN} li:has-text("food")`)

    await expect
      .poll(() => breakdown(page))
      .toEqual(['groceries | 50.00', 'coffee | 4.50', 'Just food | 5.50', 'Spent 60.00'])
    expect(await trail(page)).toMatch(/All spending\s*:\s*food/)
    expect(await behind(page)).toEqual(['Snack', 'Groceries', 'Coffee'])

    await page.click(`${BREAKDOWN} li:has-text("coffee")`)
    expect(await behind(page)).toEqual(['Coffee'])

    // The keys go back out, with the category I was in picked.
    await page.locator(BREAKDOWN).focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => trail(page)).toBe('All spending')
    const [picked] = await cellsOf(page.locator(`${BREAKDOWN} [aria-selected=true]`))
    expect(picked?.[0]).toBe('food')
    await page.keyboard.press('Enter')
    await expect.poll(() => trail(page)).toMatch(/food$/)
    await page.click(`${TRAIL} button:has-text("All spending")`)
    await expect.poll(() => trail(page)).toBe('All spending')
  })

  test('a spend opened shows its details under it, and fixing it there changes the report', async () => {
    const { page } = await launch(aHome())
    await spend(page, '12', 'Lunch', 'food')
    await spend(page, '30', 'Bus pass', 'transport')
    await toReports(page)
    await expect.poll(() => breakdown(page)).toHaveLength(3)

    await page.click(`${BREAKDOWN} li:has-text("transport")`)
    await openSpend(page.locator(`${BEHIND} li:has-text("Bus pass")`), PICKED)
    await openChip(page, 'description', PICKED)
    expect(await page.inputValue(`${PICKED} input[name=description]`)).toBe('Bus pass')

    await openChip(page, 'amount', PICKED)
    await page.fill(`${PICKED} input[name=amount]`, '3.30')
    await page.press(`${PICKED} input[name=amount]`, 'Enter')

    await expect
      .poll(() => breakdown(page))
      .toEqual(['food | 12.00', 'transport | 3.30', 'Spent 15.30'])
    expect(await page.locator(`${PICKED} [id$="-chip-amount"]`).innerText()).toContain('3.30')
  })

  test('a change saved in Reports shows in the ledger', async () => {
    const { page } = await launch(aHome())
    await spend(page, '30', 'Bus pass', 'transport')
    await toReports(page)
    await openSpend(page.locator(`${BEHIND} li:has-text("Bus pass")`), PICKED)
    await openChip(page, 'amount', PICKED)
    await page.fill(`${PICKED} input[name=amount]`, '3.30')
    await page.press(`${PICKED} input[name=amount]`, 'Enter')
    await expect.poll(() => breakdown(page)).toEqual(['transport | 3.30', 'Spent 3.30'])

    await page.click(`${NAV} button:has-text("Ledger")`)
    await expect.poll(() => rows(page)).toEqual([expect.stringMatching(/Bus pass \| 3\.30/)])
  })

  test('Ctrl+Z takes a fix back, and the report stays where I am', async () => {
    const { page, press } = await launch(aHome())
    await spend(page, '30', 'Bus pass', 'transport')
    await toReports(page)
    await openSpend(page.locator(`${BEHIND} li:has-text("Bus pass")`), PICKED)
    await openChip(page, 'amount', PICKED)
    await page.fill(`${PICKED} input[name=amount]`, '3.30')
    await page.press(`${PICKED} input[name=amount]`, 'Enter')
    await expect.poll(() => breakdown(page)).toEqual(['transport | 3.30', 'Spent 3.30'])

    await page.locator(BREAKDOWN).focus()
    press('ctrl+z')

    await expect.poll(() => breakdown(page)).toEqual(['transport | 30.00', 'Spent 30.00'])
    expect(await page.innerText(`${NAV} [aria-current=page]`)).toMatch(/^Reports/)
    expect(await page.locator(`${PICKED} [id$="-chip-amount"]`).innerText()).toContain('30.00')
  })

  test('◀ and ▶ go to the week before and after', async () => {
    const { page } = await launch(aHome())
    await spend(page, '8', 'Today', 'food')
    await spend(page, '15', 'Last week', 'fun', '', daysAgo(7))
    await toReports(page)
    await expect.poll(() => breakdown(page)).toEqual(['food | 8.00', 'Spent 8.00'])

    await page.click(`${WEEK} button[aria-label="The week before"]`)
    await expect.poll(() => breakdown(page)).toEqual(['fun | 15.00', 'Spent 15.00'])
    expect(await page.innerText(WEEK)).not.toContain('This week')

    await page.click(`${WEEK} button[aria-label="The week before"]`)
    await expect.poll(() => breakdown(page)).toEqual([''])
    expect(await page.innerText('role=main')).toContain('No spending in this week.')

    await page.click(`${WEEK} button[aria-label="The week after"]`)
    await page.click(`${WEEK} button[aria-label="The week after"]`)
    await expect.poll(() => breakdown(page)).toEqual(['food | 8.00', 'Spent 8.00'])
    expect(await page.innerText(WEEK)).toContain('This week')
  })
})
