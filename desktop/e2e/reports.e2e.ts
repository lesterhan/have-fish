// This week beside the week before, as a tree of categories: the Reports tree that replaced the
// list, and its keys (#640).

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  ADD_ACCOUNT,
  aHome,
  launch,
  openChip,
  openComposer,
  openSpend,
  rows,
  spendCells,
  WRITE,
} from './app'

const NAV = 'nav[aria-label=Places]'
const TREE = 'ol[aria-label="Spending by category"]'
const BEHIND = 'ol[aria-label="Its spends"]'
const PICKED = 'section[aria-label="The spend picked"]'
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

/** The tree's rows as `name | this week | last week | the change`, in the order they show. */
const tree = (page: Page) =>
  page.evaluate((list) => {
    const cell = (li: Element, name: string) =>
      li.querySelector(`[data-cell=${name}]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    return [...(document.querySelector(list)?.querySelectorAll('li') ?? [])].map((li) =>
      ['name', 'shown', 'before', 'change'].map((name) => cell(li, name)).join(' | '),
    )
  }, TREE)

/** The tree's foot: All spending, this week, last week, and their change. */
const total = (page: Page) =>
  page.evaluate(() => {
    const foot = [...document.querySelectorAll('p')].find((p) =>
      p.textContent?.trim().startsWith('All spending'),
    )
    return [...(foot?.children ?? [])].map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? '')
  })

/** The tree's headings, as they read. */
const headings = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector('ol[aria-label="Spending by category"]')
    const over = list?.parentElement?.parentElement?.firstElementChild
    return [...(over?.children ?? [])].map((h) => h.textContent?.trim() ?? '')
  })

/** The header's quiet line: what the week came to against the week before. */
const sums = (page: Page) => page.locator('main header p').innerText()

/** The name cell of the row the tree has selected. */
const selectedName = (page: Page) =>
  page.evaluate((list) => {
    const name = document.querySelector(`${list} [aria-selected=true] [data-cell=name]`)
    return name?.textContent?.replace(/\s+/g, ' ').trim() ?? null
  }, TREE)

/** The tree's row whose name contains `name`, as a person reads it. */
const treeRow = (page: Page, name: string) =>
  page.locator(`${TREE} li`).filter({ hasText: name }).first()

/** What the list beside the tree shows: the spends' descriptions. */
const behind = (page: Page) =>
  spendCells(page.locator(`${BEHIND} li`)).then((all) => all.map(([, description]) => description))

describe('see this week against last', () => {
  test('each category this week beside last week, and the change between them', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 900 })
    await spend(page, '60', 'Groceries', 'food')
    await spend(page, '30', 'Bus pass', 'transport')
    await spend(page, '10', 'Something', '')
    await addAccount(page, 'chequing', 'bank')
    await spend(page, '500', 'Cash out', 'cash', 'chequing')
    // Last, because the line keeps the date it was last given.
    await spend(page, '80', 'Groceries last week', 'food', '', daysAgo(7))
    await toReports(page)

    await expect
      .poll(() => tree(page))
      .toEqual([
        'expenses food | 60.00 | 80.00 | 20.00 less',
        'expenses transport | 30.00 | – | 30.00 more',
        'Unsorted | 10.00 | – | 10.00 more',
      ])
    await expect.poll(() => total(page)).toEqual(['All spending', '100.00', '80.00', '20.00 more'])
    await expect.poll(() => sums(page)).toBe('Spent 100.00, against 80.00 last week')
  })

  test('a category opens and closes, its children a level under it', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 900 })
    await spend(page, '4.50', 'Coffee', 'food:coffee')
    await spend(page, '50', 'Groceries', 'food:groceries')
    await spend(page, '5.50', 'Snack', 'food')
    await spend(page, '20', 'Movie', 'fun')
    await toReports(page)

    await expect
      .poll(() => tree(page))
      .toEqual([
        '▶ expenses food | 60.00 | – | 60.00 more',
        'expenses fun | 20.00 | – | 20.00 more',
      ])
    expect(await treeRow(page, 'expenses fun').getAttribute('aria-expanded')).toBeNull()
    // A tree, and its rows items of it, which is why the tree is the Listbox.
    expect(await page.locator(TREE).getAttribute('role')).toBe('tree')
    expect(await treeRow(page, 'expenses fun').getAttribute('role')).toBe('treeitem')
    expect(await treeRow(page, 'expenses fun').getAttribute('aria-level')).toBe('1')
    expect(await treeRow(page, 'expenses food').getAttribute('aria-expanded')).toBe('false')

    // A click selects it; a second opens it.
    await treeRow(page, 'expenses food').click()
    await expect.poll(() => selectedName(page)).toBe('▶ expenses food')
    expect(await tree(page)).toHaveLength(2)
    await treeRow(page, 'expenses food').click()

    await expect
      .poll(() => tree(page))
      .toEqual([
        '▼ expenses food | 60.00 | – | 60.00 more',
        ':groceries | 50.00 | – | 50.00 more',
        ':coffee | 4.50 | – | 4.50 more',
        'Just food | 5.50 | – | 5.50 more',
        'expenses fun | 20.00 | – | 20.00 more',
      ])
    expect(await page.locator(`${TREE} li[aria-level="2"]`).count()).toBe(3)
    expect(await treeRow(page, 'expenses food').getAttribute('aria-expanded')).toBe('true')

    // ← on a child goes to its category, its spends beside; ← again closes it, Enter opens it.
    await treeRow(page, ':coffee').click()
    await page.locator(TREE).focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => selectedName(page)).toBe('▼ expenses food')
    await expect.poll(() => behind(page)).toEqual(['Snack', 'Groceries', 'Coffee'])
    await page.keyboard.press('ArrowLeft')
    await expect
      .poll(() => tree(page))
      .toEqual([
        '▶ expenses food | 60.00 | – | 60.00 more',
        'expenses fun | 20.00 | – | 20.00 more',
      ])
    expect(await selectedName(page)).toBe('▶ expenses food')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator(`${TREE} li`).count()).toBe(5)
  })

  test('a row that has nothing this week lists no spends, and says so', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 900 })
    await spend(page, '15', 'Movie', 'fun', '', daysAgo(7))
    await toReports(page)

    await expect.poll(() => tree(page)).toEqual(['expenses fun | – | 15.00 | 15.00 less'])
    await expect.poll(() => sums(page)).toBe('Spent 0.00, against 15.00 last week')

    await treeRow(page, 'expenses fun').click()
    await expect.poll(() => behind(page)).toEqual([])
    await expect.poll(() => page.innerText('role=main')).toContain('Nothing in the week shown.')
  })

  test('nothing picked lists the whole week; a row picked lists its own spends', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 900 })
    await spend(page, '30', 'Bus pass', 'transport')
    await spend(page, '60', 'Groceries', 'food')
    await toReports(page)

    await expect
      .poll(() => behind(page).then((all) => all.sort()))
      .toEqual(['Bus pass', 'Groceries'])
    await treeRow(page, 'expenses transport').click()
    await expect.poll(() => behind(page)).toEqual(['Bus pass'])
  })

  test('a spend opened beside shows its details, and fixing it there changes its row', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 900 })
    await spend(page, '12', 'Lunch', 'food')
    await spend(page, '30', 'Bus pass', 'transport')
    await toReports(page)
    await treeRow(page, 'expenses transport').click()
    await openSpend(page.locator(`${BEHIND} li:has-text("Bus pass")`), PICKED)
    await openChip(page, 'description', PICKED)
    expect(await page.inputValue(`${PICKED} input[name=description]`)).toBe('Bus pass')

    await openChip(page, 'amount', PICKED)
    await page.fill(`${PICKED} input[name=amount]`, '3.30')
    await page.press(`${PICKED} input[name=amount]`, 'Enter')

    await expect
      .poll(() => tree(page))
      .toEqual([
        'expenses food | 12.00 | – | 12.00 more',
        'expenses transport | 3.30 | – | 3.30 more',
      ])
    expect(await page.locator(`${PICKED} [id$="-chip-amount"]`).innerText()).toContain('3.30')
  })

  test('a change saved in Reports shows in the ledger', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 900 })
    await spend(page, '30', 'Bus pass', 'transport')
    await toReports(page)
    await treeRow(page, 'expenses transport').click()
    await openSpend(page.locator(`${BEHIND} li:has-text("Bus pass")`), PICKED)
    await openChip(page, 'amount', PICKED)
    await page.fill(`${PICKED} input[name=amount]`, '3.30')
    await page.press(`${PICKED} input[name=amount]`, 'Enter')
    await expect.poll(() => tree(page)).toEqual(['expenses transport | 3.30 | – | 3.30 more'])

    await page.click(`${NAV} button:has-text("Ledger")`)
    await expect.poll(() => rows(page)).toEqual([expect.stringMatching(/Bus pass \| 3\.30/)])
  })

  test('Ctrl+Z takes a fix back, and the report stays where I am', async () => {
    const { page, press } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 900 })
    await spend(page, '30', 'Bus pass', 'transport')
    await toReports(page)
    await treeRow(page, 'expenses transport').click()
    await openSpend(page.locator(`${BEHIND} li:has-text("Bus pass")`), PICKED)
    await openChip(page, 'amount', PICKED)
    await page.fill(`${PICKED} input[name=amount]`, '3.30')
    await page.press(`${PICKED} input[name=amount]`, 'Enter')
    await expect.poll(() => tree(page)).toEqual(['expenses transport | 3.30 | – | 3.30 more'])

    await page.locator(TREE).focus()
    press('ctrl+z')

    await expect.poll(() => tree(page)).toEqual(['expenses transport | 30.00 | – | 30.00 more'])
    expect(await page.innerText(`${NAV} [aria-current=page]`)).toMatch(/^Reports/)
    expect(await page.locator(`${PICKED} [id$="-chip-amount"]`).innerText()).toContain('30.00')
  })

  test('◀ speaks of that week and the one before it, and ▶ comes back', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 900 })
    await spend(page, '8', 'Today', 'food')
    await spend(page, '15', 'Last week', 'fun', '', daysAgo(7))
    await toReports(page)
    await expect
      .poll(() => tree(page))
      .toEqual(['expenses food | 8.00 | – | 8.00 more', 'expenses fun | – | 15.00 | 15.00 less'])
    await expect
      .poll(() => headings(page))
      .toEqual(['Where it went', 'This week', 'Last week', 'Change'])

    await page.click(`${WEEK} button[aria-label="The week before"]`)
    await expect.poll(() => tree(page)).toEqual(['expenses fun | 15.00 | – | 15.00 more'])
    await expect
      .poll(() => headings(page))
      .toEqual(['Where it went', 'That week', 'Week before', 'Change'])
    await expect.poll(() => sums(page)).toBe('Spent 15.00, against 0.00 the week before')

    await page.click(`${WEEK} button[aria-label="The week before"]`)
    await expect.poll(() => tree(page)).toEqual([])
    await expect
      .poll(() => page.innerText('role=main'))
      .toContain('No spending in this week or the week before.')

    await page.click(`${WEEK} button[aria-label="The week after"]`)
    await page.click(`${WEEK} button[aria-label="The week after"]`)
    await expect.poll(() => tree(page)).toHaveLength(2)
    await expect
      .poll(() => headings(page))
      .toEqual(['Where it went', 'This week', 'Last week', 'Change'])
  })

  test('the week moves with the tree as I left it', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 1440, height: 900 })
    await spend(page, '4.50', 'Coffee', 'food:coffee')
    await spend(page, '50', 'Groceries', 'food:groceries')
    await spend(page, '9', 'Coffee last week', 'food:coffee', '', daysAgo(7))
    await toReports(page)

    await treeRow(page, 'expenses food').click()
    await treeRow(page, 'expenses food').click()
    await expect.poll(() => page.locator(`${TREE} li`).count()).toBe(3)
    await treeRow(page, ':coffee').click()
    await expect.poll(() => selectedName(page)).toBe(':coffee')

    await page.click(`${WEEK} button[aria-label="The week before"]`)
    await expect
      .poll(() => tree(page))
      .toEqual(['▼ expenses food | 9.00 | – | 9.00 more', ':coffee | 9.00 | – | 9.00 more'])
    expect(await selectedName(page)).toBe(':coffee')

    // A week with nothing in it: nothing open, nothing selected.
    await page.click(`${WEEK} button[aria-label="The week before"]`)
    await expect.poll(() => tree(page)).toEqual([])
    await expect.poll(() => selectedName(page)).toBeNull()
  })
})
