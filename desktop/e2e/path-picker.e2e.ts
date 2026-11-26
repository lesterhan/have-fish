// Picking an account by its path, from the spend form and a spend's details: the level the value
// is in, the trail, letters finding any path, a new name last, and Escape putting it back.
// Entry-22's acceptance.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { copy } from '../copy'
import {
  ADD_ACCOUNT,
  aHome,
  fromLine,
  launch,
  offeredPaths,
  openChip,
  openComposer,
  openSpend,
  PANE,
  pickPath,
  rows,
  selectedRow,
  WRITE,
} from './app'

const LIST = 'ol[aria-label=Ledger]'
const WRITE_TO = `${WRITE} input[name=to]`
const WRITE_FROM = `${WRITE} input[name=from]`
const PANE_TO = `${PANE} input[name=to]`
const OPTIONS = `${PANE} [role=listbox][aria-label="Your categories and accounts"]`
const FROM_OPTIONS = `${WRITE} [role=listbox][aria-label="Your accounts and income"]`

const row = (page: Page, text: string) => page.locator(`${LIST} li`, { hasText: text })
const offered = (page: Page, options = OPTIONS) =>
  offeredPaths(page.locator(`${options} [role=option]`))

/** A spend in `category`, written through the form; Esc lands it and closes the line. */
async function writeIn(page: Page, amount: string, description: string, category: string) {
  const before = (await rows(page)).length
  await openComposer(page)
  await page.fill(`${WRITE} input[name=amount]`, amount)
  await page.fill(`${WRITE} input[name=description]`, description)
  await pickPath(page, WRITE_TO, category)
  await page.locator(`${WRITE} input[name=amount]`).press('Enter')
  await expect.poll(() => rows(page)).toHaveLength(before + 1)
  await page.keyboard.press('Escape')
  await page.waitForSelector(WRITE, { state: 'detached' })
}

async function addAccount(page: Page, name: string, kind: string) {
  await page.click('nav[aria-label=Places] button:has-text("Accounts")')
  await page.click(ADD_ACCOUNT)
  await page.fill('section[aria-label="The account"] input[name=name]', name)
  await page.selectOption('section[aria-label="The account"] select[name=kind]', kind)
  await page.locator('section[aria-label="The account"] input[name=name]').press('Enter')
  // Accounts shows a path as a tree, so the row says its last part.
  await page.waitForSelector(`ol[aria-label=Accounts] li:has-text("${name.split(':').pop()}")`)
  await page.click('nav[aria-label=Places] button:has-text("Ledger")')
}

describe('picking To by its path', () => {
  test('a value opens at its level, the trail leads back, letters find any path, and Create is last', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '4', 'Coffee', 'food:coffee')
    await writeIn(page, '12', 'Lunch', 'food:restaurants')
    await writeIn(page, '3', 'Bus', 'transport:transit')

    await openSpend(row(page, 'Lunch'))
    await openChip(page, 'to')

    // At the value's level: its siblings, the ones used last first.
    await expect
      .poll(() => offered(page))
      .toEqual(['expenses:food:restaurants', 'expenses:food:coffee'])
    // The trail says where it is, and each part is a way back.
    await expect
      .poll(() => page.getByRole('button', { name: 'food', exact: true }).isVisible())
      .toBe(true)
    await page.getByRole('button', { name: 'expenses', exact: true }).click()
    await expect.poll(() => offered(page)).toEqual(['expenses:transport', 'expenses:food'])
    await page.getByRole('button', { name: 'Open food' }).click()
    await expect
      .poll(() => offered(page))
      .toEqual(['expenses:food:restaurants', 'expenses:food:coffee'])

    // Letters find every path with them in order, and a name none has is Create, last.
    await page.fill(PANE_TO, 'cof')
    await expect.poll(() => offered(page)).toEqual(['expenses:food:coffee', 'expenses:food:cof'])

    // Leaving without picking puts back what was there.
    await page.keyboard.press('Escape')
    expect(await page.inputValue(PANE_TO)).toBe('food:restaurants')
    await expect.poll(() => page.locator(OPTIONS).isVisible()).toBe(false)

    // Picking a new name creates it, and the card saves at once.
    await page.fill(PANE_TO, 'bakery')
    await expect.poll(() => offered(page)).toEqual(['expenses:food:bakery'])
    await page.keyboard.press('Enter')
    await expect.poll(() => row(page, 'Lunch').innerText()).toContain('food:bakery')
  })
})

describe('picking From by its path', () => {
  test('its value opens at its level; letters find an account under another root', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '4.50', 'Coffee', 'food')
    await addAccount(page, 'visa', 'card')

    await openComposer(page)
    await page.focus(WRITE_FROM)
    expect(await page.inputValue(WRITE_FROM)).toBe('cash')
    await page.press(WRITE_FROM, 'ArrowDown')
    await expect.poll(() => offered(page, FROM_OPTIONS)).toEqual(['assets:cash'])

    await page.fill(WRITE_FROM, 'vi')
    await expect.poll(() => offered(page, FROM_OPTIONS)).toEqual(['liabilities:visa', 'income:vi'])
    await page.keyboard.press('Escape')
    await openComposer(page)
    expect(await page.inputValue(WRITE_FROM)).toBe('cash')
  })
})

// A pick from a level's list, with the arrows rather than typed, puts the whole path in the field.
describe('a pick from a level is the path picked', () => {
  const COMPOSER_TO_OPTIONS = `${WRITE} [role=listbox][aria-label="Your categories and accounts"]`

  test("in a spend's To chip", async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '4', 'Coffee', 'food:coffee')
    await writeIn(page, '12', 'Lunch', 'food:restaurants')

    await openSpend(row(page, 'Lunch'))
    await openChip(page, 'to')
    await expect
      .poll(() => offered(page))
      .toEqual(['expenses:food:restaurants', 'expenses:food:coffee'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    await expect.poll(() => row(page, 'Lunch').innerText()).toContain('food:coffee')
  })

  test('in a refile', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '2', 'Tea', 'food:tea')
    await writeIn(page, '4', 'Coffee', 'food:coffee')

    await page.locator(LIST).focus()
    await page.keyboard.press('r')
    const refile = `${LIST} [role=listbox][aria-label="Your categories and accounts"]`
    await expect
      .poll(() => offered(page, refile))
      .toEqual(['expenses:food:coffee', 'expenses:food:tea'])
    // The arrows move in the picker's list, not the ledger's rows.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    await expect.poll(() => row(page, 'Coffee').innerText()).toContain('food:tea')
  })

  test('the selected row’s hint offers refile on a spend', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '4', 'Coffee', 'food:coffee')

    await page.locator(LIST).focus()

    await expect.poll(() => selectedRow(page).innerText()).toContain(copy.spends.list.refile)
  })

  test("in the line's To", async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '4', 'Coffee', 'food:coffee')
    await writeIn(page, '12', 'Lunch', 'food:restaurants')

    await openComposer(page)
    await page.fill(`${WRITE} input[name=amount]`, '3')
    await page.fill(`${WRITE} input[name=description]`, 'Muffin')
    await pickPath(page, WRITE_TO, 'food:restaurants')
    // Entered again, it opens at the level its value is in.
    await page.focus(`${WRITE} input[name=amount]`)
    await page.focus(WRITE_TO)
    await page.keyboard.press('ArrowDown')
    await expect
      .poll(() => offered(page, COMPOSER_TO_OPTIONS))
      .toEqual(['expenses:food:restaurants', 'expenses:food:coffee'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    expect(await page.inputValue(WRITE_TO)).toBe('food:coffee')

    await page.locator(`${WRITE} input[name=amount]`).press('Enter')
    await expect.poll(() => row(page, 'Muffin').innerText()).toContain('food:coffee')
  })

  test("in the line's From", async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '4', 'Coffee', 'food')
    await addAccount(page, 'tangerine:chequing', 'bank')
    await addAccount(page, 'tangerine:savings', 'bank')

    await openComposer(page)
    await page.fill(`${WRITE} input[name=amount]`, '5')
    await page.fill(`${WRITE} input[name=description]`, 'Rent')
    await pickPath(page, WRITE_FROM, 'tangerine:chequing')
    await page.focus(`${WRITE} input[name=amount]`)
    await page.focus(WRITE_FROM)
    await page.keyboard.press('ArrowDown')
    await expect
      .poll(() => offered(page, FROM_OPTIONS))
      .toEqual(['assets:tangerine:chequing', 'assets:tangerine:savings'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    expect(await page.inputValue(WRITE_FROM)).toBe('tangerine:savings')

    await page.locator(`${WRITE} input[name=amount]`).press('Enter')
    await expect.poll(() => rows(page)).toHaveLength(2)
    // The line stays open after a write: Esc lands it before the row opens.
    await page.keyboard.press('Escape')
    await page.waitForSelector(WRITE, { state: 'detached' })
    await openSpend(row(page, 'Rent'))
    expect(await fromLine(page).innerText()).toMatch(/tangerine\W+savings/)
  })
})

describe("a refile's list in the room the window has", () => {
  const SPENDS = [
    ['2', 'Tea', 'food:tea'],
    ['4', 'Coffee', 'food:coffee'],
    ['12', 'Lunch', 'food:restaurants'],
    ['3', 'Muffin', 'food:snacks'],
    ['30', 'Groceries', 'food:groceries'],
    ['6', 'Juice', 'food:juice'],
    ['9', 'Bagels', 'food:bakery'],
    ['15', 'Sushi', 'food:takeout'],
  ] as const
  const REFILE = `${LIST} [role=listbox][aria-label="Your categories and accounts"]`

  /** Eight spends, each in its own category: a list longer than a layer's 14rem. */
  async function eightSpends() {
    const { page } = await launch(aHome())
    for (const [amount, what, category] of SPENDS) await writeIn(page, amount, what, category)
    return page
  }

  /** Selects the first or last spend with the keys (a click would open it), puts 60px of window
   * under its row, and refiles it. */
  async function refileNearTheBottom(page: Page, key: 'Home' | 'End') {
    await page.focus(LIST)
    await page.keyboard.press(key)
    const selected = page.locator(`${LIST} li[aria-selected=true]`)
    const at = await selected.boundingBox()
    if (at === null) throw new Error('no spend is selected')
    const width = await page.evaluate(() => innerWidth)
    await page.setViewportSize({ width, height: Math.ceil(at.y + at.height + 60) })
    await page.keyboard.press('r')
    // Only the options in its room are drawn, so it waits for the list, not all eight.
    await page.locator(REFILE).waitFor()
  }

  /** Where the field and the list's scroller are drawn, and whether the list scrolls. */
  const where = (page: Page) =>
    page.locator(REFILE).evaluate((list) => {
      const scroller = list.parentElement as HTMLElement
      const field = document.querySelector('ol[aria-label=Ledger] input[name=to]') as HTMLElement
      const drawn = scroller.getBoundingClientRect()
      return {
        top: drawn.top,
        bottom: drawn.bottom,
        fieldTop: field.getBoundingClientRect().top,
        scrolls: scroller.scrollHeight > scroller.clientHeight,
      }
    })

  test('near the bottom, it opens above its field, clear of it', async () => {
    const page = await eightSpends()
    await refileNearTheBottom(page, 'End')

    await expect
      .poll(async () => (await where(page)).bottom <= (await where(page)).fieldTop)
      .toBe(true)
    const drawn = await where(page)
    expect(drawn.top).toBeGreaterThanOrEqual(0)
    expect(drawn.scrolls).toBe(true)
  })

  test('with room for it on neither side, it takes the larger, clear of its field, and scrolls', async () => {
    const page = await eightSpends()
    await refileNearTheBottom(page, 'Home')

    await expect
      .poll(async () => (await where(page)).bottom <= (await where(page)).fieldTop)
      .toBe(true)
    const drawn = await where(page)
    expect(drawn.top).toBeGreaterThanOrEqual(0)
    expect(drawn.scrolls).toBe(true)

    // Placed again (the window says it resized), it stays scrolled to its end, deeper than the
    // list could scroll uncapped.
    const end = await page.locator(REFILE).evaluate((list) => {
      const scroller = list.parentElement as HTMLElement
      scroller.scrollTop = scroller.scrollHeight
      return scroller.scrollTop
    })
    await page.evaluate(() => dispatchEvent(new Event('resize')))
    await page.waitForTimeout(200)
    expect(await page.locator(REFILE).evaluate((list) => list.parentElement?.scrollTop)).toBe(end)
  })
})
