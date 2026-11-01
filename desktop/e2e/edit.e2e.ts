// Fixing a spend in the pane beside the list, as a person does it, in the built app.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, PANE, rows, writeDown } from './app'

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

const LIST = 'ol[aria-label=Spends]'
const SELECTED = `${LIST} li[aria-selected=true]`
const AMOUNT = `${PANE} input[name=amount]`
const DESCRIPTION = `${PANE} input[name=description]`
const DOT = `${PANE} .heading`

/** Lunch, then Coffee: Coffee is newest, at the top, and selected. */
async function twoSpends(page: Page) {
  await writeDown(page, '12', 'Lunch')
  await expect.poll(() => rows(page)).toHaveLength(1)
  await writeDown(page, '4.50', 'Coffee')
  await expect
    .poll(() => rows(page))
    .toEqual([`${today()} | Coffee | 4.50 CAD`, `${today()} | Lunch | 12.00 CAD`])
}

const row = (page: Page, text: string) => page.locator(`${LIST} li`, { hasText: text })
const focusedName = (page: Page) =>
  page.evaluate(
    () => document.activeElement?.getAttribute('name') ?? document.activeElement?.tagName,
  )

describe('fix a spend', () => {
  test('the newest is selected when the app opens, and the one just written after that', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    expect(await page.textContent(SELECTED)).toContain('Coffee')
    expect(await page.inputValue(DESCRIPTION)).toBe('Coffee')
    expect(await page.inputValue(AMOUNT)).toBe('4.50')
  })

  test('change the amount and what it was for, Enter: the list shows them, nothing else changed', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await row(page, 'Lunch').click()
    await page.fill(DESCRIPTION, 'Lunch with Sam')
    await page.fill(AMOUNT, '15')
    await page.press(AMOUNT, 'Enter')

    await expect
      .poll(() => rows(page))
      .toEqual([`${today()} | Coffee | 4.50 CAD`, `${today()} | Lunch with Sam | 15.00 CAD`])
    expect(await page.inputValue(AMOUNT)).toBe('15.00')
    expect(await page.textContent(DOT)).not.toContain('●')
    expect(await page.textContent(SELECTED)).toContain('Lunch with Sam')
  })

  test('the Save button saves too', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await page.fill(DESCRIPTION, 'Flat white')
    await page.click(`${PANE} button[type=submit]`)

    await expect.poll(async () => (await rows(page))[0]).toBe(`${today()} | Flat white | 4.50 CAD`)
  })

  test('Escape while editing: nothing changes', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await page.fill(DESCRIPTION, 'Not coffee')
    await page.fill(AMOUNT, '99')
    await page.press(AMOUNT, 'Escape')

    expect(await page.inputValue(DESCRIPTION)).toBe('Coffee')
    expect(await page.inputValue(AMOUNT)).toBe('4.50')
    expect(await page.textContent(DOT)).not.toContain('●')
    expect(await rows(page)).toEqual([
      `${today()} | Coffee | 4.50 CAD`,
      `${today()} | Lunch | 12.00 CAD`,
    ])
  })

  test('an unsaved change shows ● in the pane and the list, and is still there after moving away', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await row(page, 'Lunch').click()
    await page.fill(AMOUNT, '15')

    expect(await page.textContent(DOT)).toContain('●')
    expect(await page.textContent(DOT)).toContain('unsaved changes')
    expect(await rows(page)).toEqual([
      `${today()} | Coffee | 4.50 CAD`,
      `${today()} | Lunch | 12.00 CAD | ●unsaved changes`,
    ])

    await row(page, 'Coffee').click()
    expect(await page.inputValue(AMOUNT)).toBe('4.50')
    expect(await page.textContent(DOT)).not.toContain('●')

    // A write refreshes the list; the draft stays.
    await writeDown(page, '3', 'Tea')
    await expect.poll(async () => (await rows(page))[0]).toContain('Tea')
    await row(page, 'Lunch').click()
    expect(await page.inputValue(AMOUNT)).toBe('15')
    expect(await page.textContent(DOT)).toContain('●')
  })

  test('something that is not an amount: nothing is saved, and the field says why', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await page.fill(AMOUNT, 'abc')
    await page.press(AMOUNT, 'Enter')

    const error = page.locator('#pane-amount-error')
    await expect.poll(() => error.textContent()).toMatch(/isn't an amount/)
    expect(await page.getAttribute(AMOUNT, 'aria-invalid')).toBe('true')
    expect(await page.getAttribute(AMOUNT, 'aria-describedby')).toBe('pane-amount-error')
    expect(await page.inputValue(AMOUNT)).toBe('abc')
    expect(await page.textContent(DOT)).toContain('●')
    expect(await rows(page)).toEqual([
      `${today()} | Coffee | 4.50 CAD | ●unsaved changes`,
      `${today()} | Lunch | 12.00 CAD`,
    ])
  })

  test('from the keyboard: arrows move through the list, Enter goes to the pane', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await page.focus(LIST)
    await page.keyboard.press('ArrowDown')
    expect(await page.textContent(SELECTED)).toContain('Lunch')
    expect(await page.inputValue(DESCRIPTION)).toBe('Lunch')
    await page.keyboard.press('ArrowUp')
    expect(await page.textContent(SELECTED)).toContain('Coffee')

    await page.keyboard.press('Enter')
    expect(await focusedName(page)).toBe('description')
  })

  test('in a narrow window the pane slides over the list, and Back returns to it', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 420, height: 700 })
    await twoSpends(page)
    const pane = page.locator(PANE)

    await expect.poll(() => pane.isVisible()).toBe(false)
    await row(page, 'Lunch').click()
    await expect.poll(() => pane.isVisible()).toBe(true)
    expect(await page.inputValue(DESCRIPTION)).toBe('Lunch')

    await page.click(`${PANE} .back`)
    await expect.poll(() => pane.isVisible()).toBe(false)
    expect(await focusedName(page)).toBe('OL')
  })

  test('a spend picked in a wide window leaves the list uncovered when the window narrows', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    await row(page, 'Lunch').click()

    await page.setViewportSize({ width: 420, height: 700 })

    await expect.poll(() => page.locator(PANE).isVisible()).toBe(false)
    await row(page, 'Coffee').click({ timeout: 5_000 })
    await expect.poll(() => page.inputValue(DESCRIPTION)).toBe('Coffee')
  })
})
