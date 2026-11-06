// Fixing a spend in its details, open under its row, as a person does it, in the built app:
// Entry-2's acceptance, and Entry-21's, which opened the details where the spend sits.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  aHome,
  launch,
  openSelected,
  openSpend,
  PANE,
  rows,
  shownDay,
  unsavedInPane,
  writeDown,
} from './app'

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

const LIST = 'ol[aria-label=Ledger]'
const SELECTED = `${LIST} li[aria-selected=true]`
const AMOUNT = `${PANE} input[name=amount]`
const DESCRIPTION = `${PANE} input[name=description]`

/** Lunch, then Coffee: Coffee is newest, at the top, and selected. */
async function twoSpends(page: Page) {
  await writeDown(page, '12', 'Lunch')
  await expect.poll(() => rows(page)).toHaveLength(1)
  await writeDown(page, '4.50', 'Coffee')
  await expect
    .poll(() => rows(page))
    .toEqual([`${shownDay(today())} | Coffee | 4.50`, `${shownDay(today())} | Lunch | 12.00`])
}

const row = (page: Page, text: string) => page.locator(`${LIST} li`, { hasText: text })
const focusedName = (page: Page) =>
  page.evaluate(
    () => document.activeElement?.getAttribute('name') ?? document.activeElement?.tagName,
  )
const isOpen = (page: Page) => page.locator(PANE).isVisible()

/** The open card's box and its row's, the list's, and how faded each other row is. */
const placed = async (page: Page) => {
  // The card drops in 4px; measure where it lands.
  await page.waitForFunction(() => document.getAnimations().length === 0)
  return page.evaluate(
    ({ list, card }) => {
      const ol = document.querySelector(list)
      const box = (e: Element | null | undefined) => {
        const r = e?.getBoundingClientRect()
        return (
          r && {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            left: r.left,
            right: r.right,
          }
        )
      }
      const open = ol?.querySelector('li[aria-selected=true]')
      const others = [...(ol?.querySelectorAll('li') ?? [])].filter((li) => li !== open)
      return {
        row: box(open),
        card: box(document.querySelector(card)),
        list: box(ol?.parentElement),
        faded: others.map((li) => getComputedStyle(li).opacity),
      }
    },
    { list: LIST, card: PANE },
  )
}

describe('fix a spend', () => {
  test('the newest is selected when the app opens; Enter opens it, in What for', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    expect(await page.textContent(SELECTED)).toContain('Coffee')
    expect(await isOpen(page)).toBe(false)
    await openSelected(page)
    expect(await focusedName(page)).toBe('description')
    expect(await page.inputValue(DESCRIPTION)).toBe('Coffee')
    expect(await page.inputValue(AMOUNT)).toBe('4.50')
  })

  test('change the amount and what it was for, Enter: the list shows them, nothing else changed', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await openSpend(row(page, 'Lunch'))
    await page.fill(DESCRIPTION, 'Lunch with Sam')
    await page.fill(AMOUNT, '15')
    await page.press(AMOUNT, 'Enter')

    await expect
      .poll(() => rows(page))
      .toEqual([
        `${shownDay(today())} | Coffee | 4.50`,
        `${shownDay(today())} | Lunch with Sam | 15.00`,
      ])
    expect(await page.inputValue(AMOUNT)).toBe('15.00')
    expect(await unsavedInPane(page)).toBe(0)
    expect(await page.textContent(SELECTED)).toContain('Lunch with Sam')
  })

  test('the Save button saves too', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    await openSelected(page)

    await page.fill(DESCRIPTION, 'Flat white')
    await page.locator(PANE).getByRole('button', { name: 'Save' }).click()

    await expect
      .poll(async () => (await rows(page))[0])
      .toBe(`${shownDay(today())} | Flat white | 4.50`)
  })

  test('Escape while editing: nothing changes, the details close, and the row stays selected', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    await openSelected(page)

    await page.fill(DESCRIPTION, 'Not coffee')
    await page.fill(AMOUNT, '99')
    await page.press(AMOUNT, 'Escape')

    await expect.poll(() => isOpen(page)).toBe(false)
    expect(await page.textContent(SELECTED)).toContain('Coffee')
    expect(await focusedName(page)).toBe('OL')
    expect(await rows(page)).toEqual([
      `${shownDay(today())} | Coffee | 4.50`,
      `${shownDay(today())} | Lunch | 12.00`,
    ])
    await openSelected(page)
    expect(await page.inputValue(DESCRIPTION)).toBe('Coffee')
    expect(await page.inputValue(AMOUNT)).toBe('4.50')
    expect(await unsavedInPane(page)).toBe(0)
  })

  test('an unsaved change shows ● in the details and the list, and is still there after moving away', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await openSpend(row(page, 'Lunch'))
    await page.fill(AMOUNT, '15')

    expect(await unsavedInPane(page)).toBe(1)
    expect(await rows(page)).toEqual([
      `${shownDay(today())} | Coffee | 4.50`,
      `${shownDay(today())} | Lunch | 12.00 | ●unsaved changes`,
    ])

    // Reaching for another row closes the details; the draft stays.
    await row(page, 'Coffee').click()
    await expect.poll(() => isOpen(page)).toBe(false)
    expect(await page.textContent(SELECTED)).toContain('Coffee')

    // A write refreshes the list; the draft stays.
    await writeDown(page, '3', 'Tea')
    await expect.poll(async () => (await rows(page))[0]).toContain('Tea')
    await openSpend(row(page, 'Lunch'))
    expect(await page.inputValue(AMOUNT)).toBe('15')
    expect(await unsavedInPane(page)).toBe(1)
  })

  test('something that is not an amount: nothing is saved, and the field says why', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    await openSelected(page)

    await page.fill(AMOUNT, 'abc')
    await page.press(AMOUNT, 'Enter')

    const error = page.locator('#pane-amount-error')
    await expect.poll(() => error.textContent()).toMatch(/isn't an amount/)
    expect(await page.getAttribute(AMOUNT, 'aria-invalid')).toBe('true')
    expect(await page.getAttribute(AMOUNT, 'aria-describedby')).toBe('pane-amount-error')
    expect(await page.inputValue(AMOUNT)).toBe('abc')
    expect(await unsavedInPane(page)).toBe(1)
    expect(await rows(page)).toEqual([
      `${shownDay(today())} | Coffee | 4.50 | ●unsaved changes`,
      `${shownDay(today())} | Lunch | 12.00`,
    ])
  })

  test('from the keyboard: arrows move through the list, Enter opens the details, Esc closes them', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await page.focus(LIST)
    await page.keyboard.press('ArrowDown')
    expect(await page.textContent(SELECTED)).toContain('Lunch')
    await page.keyboard.press('ArrowUp')
    expect(await page.textContent(SELECTED)).toContain('Coffee')

    await page.keyboard.press('Enter')
    await expect.poll(() => isOpen(page)).toBe(true)
    expect(await focusedName(page)).toBe('description')
    await page.keyboard.press('Escape')
    await expect.poll(() => isOpen(page)).toBe(false)
    expect(await focusedName(page)).toBe('OL')
    expect(await page.textContent(SELECTED)).toContain('Coffee')
  })
})

describe('open a transaction where it sits', () => {
  test('a click selects a row, and a second opens it under the row, the rest stepping back', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await row(page, 'Lunch').click()
    expect(await page.textContent(SELECTED)).toContain('Lunch')
    expect(await isOpen(page)).toBe(false)
    await row(page, 'Lunch').click()
    await expect.poll(() => isOpen(page)).toBe(true)
    expect(await page.inputValue(DESCRIPTION)).toBe('Lunch')

    const at = await placed(page)
    // Attached: the card starts where its row ends, and is as wide as the tile.
    expect(Math.abs((at.card?.top ?? 0) - (at.row?.bottom ?? 0))).toBeLessThanOrEqual(1)
    expect(at.faded).toEqual(['0.5'])
  })

  test('in a narrow window the details open in place just the same, inside the list', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 420, height: 700 })
    await twoSpends(page)

    await openSelected(page)
    expect(await page.inputValue(DESCRIPTION)).toBe('Coffee')
    const at = await placed(page)
    expect(Math.abs((at.card?.top ?? 0) - (at.row?.bottom ?? 0))).toBeLessThanOrEqual(1)
    expect(at.card?.left).toBeGreaterThanOrEqual(at.list?.left ?? 0)
    expect(at.card?.right).toBeLessThanOrEqual(at.list?.right ?? 0)
    // Nothing slides over the list: the form above it is still there to use.
    expect(await page.isVisible('form[aria-label="Write down a spend"]')).toBe(true)
  })
})
