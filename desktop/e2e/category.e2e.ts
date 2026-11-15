// Saying what a spend was for: Entry-3's acceptance, with real keys.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  ADD_ACCOUNT,
  aHome,
  focusedName,
  launch,
  offeredPaths,
  openChip,
  openComposer,
  openSelected,
  openSpend,
  PANE,
  rows,
  WRITE,
} from './app'

const CATEGORY = `${WRITE} input[name=to]`
const OPTIONS = `${WRITE} [role=listbox][aria-label="Your categories and accounts"]`
const PANE_CATEGORY = `${PANE} input[name=to]`

/** Amount, Tab, what for, Tab: the cursor in To. */
async function upToCategory(page: Page, amount: string, description: string) {
  await openComposer(page)
  await page.locator(`${WRITE} input[name=amount]`).focus()
  await page.keyboard.type(amount)
  await page.keyboard.press('Tab')
  await page.keyboard.type(description)
  await page.keyboard.press('Tab')
}

/** A spend in a category, as a person types it: the category, Enter to pick, Enter to save. */
async function writeIn(page: Page, amount: string, description: string, category: string) {
  const before = (await rows(page)).length
  await upToCategory(page, amount, description)
  await page.keyboard.type(category)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect.poll(() => rows(page)).toHaveLength(before + 1)
}

const offered = (page: Page) => offeredPaths(page.locator(`${OPTIONS} [role=option]`))
/**
 * Where the selected spend went, as its details say. It opens the chip to read it, then puts
 * the chip away: an editor left open would keep showing what was typed, not what the ledger
 * holds after an undo.
 */
const categoryOfSelected = async (page: Page) => {
  if (!(await page.isVisible(PANE))) await openSelected(page)
  await openChip(page, 'to')
  const value = await page.inputValue(PANE_CATEGORY)
  // The list closes first, then the chip's editor.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  return value
}

describe('a category for a spend I write down', () => {
  test('one I have never used is offered as new, and made', async () => {
    const { page } = await launch(aHome())

    await upToCategory(page, '12', 'Lunch')
    await page.keyboard.type('food')
    await expect.poll(() => offered(page)).toEqual(['expenses:food'])
    await page.keyboard.press('Enter')
    expect(await page.inputValue(CATEGORY)).toBe('food')
    expect(await rows(page)).toEqual([])
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(1)
    expect(await categoryOfSelected(page)).toBe('food')
    await openComposer(page)
    expect(await page.inputValue(CATEGORY)).toBe('')
  })

  test('the ones I have used are suggested as I type, most used first, and Enter picks one', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '3', 'Bus', 'transport')
    await writeIn(page, '12', 'Lunch', 'food')
    await writeIn(page, '4', 'Tea', 'food')

    await upToCategory(page, '5', 'Cake')
    await page.keyboard.type('o')
    await expect
      .poll(() => offered(page))
      .toEqual(['expenses:food', 'expenses:transport', 'expenses:o'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    expect(await page.inputValue(CATEGORY)).toBe('transport')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(4)
    expect(await categoryOfSelected(page)).toBe('transport')
  })

  test('typed the way it was first written, but in another case, it is the same one', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '12', 'Lunch', 'food')

    await upToCategory(page, '4', 'Tea')
    await page.keyboard.type('FOOD')
    await expect.poll(() => offered(page)).toEqual(['expenses:food'])
  })

  test('skipped, the spend is still saved, as unsorted, in three steps', async () => {
    const { page } = await launch(aHome())
    expect(await page.getAttribute(CATEGORY, 'placeholder')).toBe('expenses:food:coffee')

    await page.locator(`${WRITE} input[name=amount]`).focus()
    await page.keyboard.type('4.50')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Coffee')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(1)
    expect(await categoryOfSelected(page)).toBe('unsorted')
  })

  test('a half-typed name left with Tab goes back, and nothing is made', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '4', 'Tea', 'food:groceries')

    await upToCategory(page, '9.99', '')
    await page.keyboard.type('gro')
    await expect.poll(() => offered(page)).toEqual(['expenses:food:groceries', 'expenses:gro'])
    await page.keyboard.press('Tab')
    await expect.poll(() => page.inputValue(CATEGORY)).toBe('')
    await expect.poll(() => focusedName(page)).toBe('from')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(2)
    expect(await categoryOfSelected(page)).toBe('unsorted')
    await openComposer(page)
    await page.locator(CATEGORY).focus()
    await page.keyboard.type('gro')
    await expect.poll(() => offered(page)).toEqual(['expenses:food:groceries', 'expenses:gro'])
    expect(await page.locator(`${OPTIONS} [data-create="expenses:gro"]`).count()).toBe(1)
  })

  test('a half-typed name left with a click goes back, and the spend is unsorted', async () => {
    const { page } = await launch(aHome())

    await openComposer(page)
    await page.fill(`${WRITE} input[name=amount]`, '30')
    await page.fill(CATEGORY, 'gifts')
    await page.click(`${WRITE} input[name=amount]`)
    await expect.poll(() => page.inputValue(CATEGORY)).toBe('')
    await page.locator(`${WRITE} input[name=amount]`).press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(1)
    expect(await categoryOfSelected(page)).toBe('unsorted')
  })

  test('a name I have, typed whole in another case and left with Tab, is the one I have', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '4', 'Tea', 'food:groceries')

    await upToCategory(page, '5', 'Bread')
    await page.keyboard.type('Food:Groceries')
    await expect.poll(() => offered(page)).toContain('expenses:food:groceries')
    await page.keyboard.press('Tab')
    await expect.poll(() => page.inputValue(CATEGORY)).toBe('food:groceries')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(2)
    expect(await categoryOfSelected(page)).toBe('food:groceries')
  })

  test('a new name picked with Create stays when I leave', async () => {
    const { page } = await launch(aHome())

    await upToCategory(page, '12', 'Lunch')
    await page.keyboard.type('gro')
    await expect.poll(() => offered(page)).toEqual(['expenses:gro'])
    await page.keyboard.press('Enter')
    await expect.poll(() => page.inputValue(CATEGORY)).toBe('gro')
    await page.keyboard.press('Tab')
    await expect.poll(() => focusedName(page)).toBe('from')
    expect(await page.inputValue(CATEGORY)).toBe('gro')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toHaveLength(1)
    expect(await categoryOfSelected(page)).toBe('gro')
  })

  test('a name with an empty part is refused, and To says why', async () => {
    const { page } = await launch(aHome())

    await openComposer(page)
    await page.fill(`${WRITE} input[name=amount]`, '30')
    await page.fill(CATEGORY, 'food::x')
    // The first Enter picks its Create; the second writes the line.
    await page.press(CATEGORY, 'Enter')
    await page.press(CATEGORY, 'Enter')

    await expect
      .poll(() => page.locator(`${WRITE} [role=alert]`).innerText())
      .toBe('not a category')
    await expect.poll(() => focusedName(page)).toBe('to')
    expect(await rows(page)).toEqual([])
  })
})

describe('changing the category in its details', () => {
  test('change the category, Enter: it saves at once; Ctrl+Z puts it back', async () => {
    const { page, press } = await launch(aHome())
    await writeIn(page, '12', 'Lunch', 'food')
    await openSelected(page)

    await openChip(page, 'to')
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('fun')
    await page.keyboard.press('Enter')
    expect(await categoryOfSelected(page)).toBe('fun')

    await page.locator('ol[aria-label=Ledger]').focus()
    press('ctrl+z')
    await expect.poll(() => categoryOfSelected(page)).toBe('food')
  })

  test('a half-typed name left with Tab goes back to where the spend went', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '12', 'Lunch', 'food')
    await openSelected(page)

    await openChip(page, 'to')
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('gro')
    await page.keyboard.press('Tab')
    await expect.poll(() => page.inputValue(PANE_CATEGORY)).toBe('food')
  })

  test('a starting balance has no category to change', async () => {
    const { page } = await launch(aHome())
    await page.click('nav button:has-text("Accounts")')
    await page.click(ADD_ACCOUNT)
    const adding = 'section[aria-label="The account"] form[aria-label="Add an account"]'
    await page.fill(`${adding} input[name=name]`, 'chequing')
    await page.click(`${adding} details summary`)
    await page.fill(`${adding} input[name=start]`, '100')
    await page.locator(`${adding} input[name=name]`).press('Enter')
    await page.waitForSelector('ol[aria-label=Accounts] li:has-text("chequing")')

    await page.click('nav button:has-text("Ledger")')
    await openSpend(page.locator('ol[aria-label=Ledger] li'))

    await expect.poll(() => page.locator(PANE).isVisible()).toBe(true)
    expect(await page.locator(`${PANE} [id$="-chip-amount"]`).count()).toBe(1)
    expect(await page.locator(`${PANE} [id$="-chip-to"]`).count()).toBe(0)
  })
})
