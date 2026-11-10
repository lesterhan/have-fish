// Refiling a spend from the list: R opens the path picker on its To, a pick saves at once, undo
// takes it back, and the selected row shows its key. Entry-23's acceptance.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, offeredPaths, openComposer, rows, WRITE } from './app'

const LIST = 'ol[aria-label=Ledger]'
const OPTIONS = `${LIST} [role=listbox][aria-label="Your categories and accounts"]`
const REFILE = `${LIST} input[name=to]`

const row = (page: Page, text: string) => page.locator(`${LIST} li`, { hasText: text })
const offered = (page: Page) => offeredPaths(page.locator(`${OPTIONS} [role=option]`))

/** A spend in `category`, written through the form. */
async function writeIn(page: Page, amount: string, description: string, category: string) {
  const before = (await rows(page)).length
  await openComposer(page)
  await page.fill(`${WRITE} input[name=amount]`, amount)
  await page.fill(`${WRITE} input[name=description]`, description)
  await page.fill(`${WRITE} input[name=to]`, category)
  await page.locator(`${WRITE} input[name=amount]`).press('Enter')
  await expect.poll(() => rows(page)).toHaveLength(before + 1)
}

describe('refiling a spend from the list', () => {
  test('R opens the path picker on its To, a pick saves at once, and undo takes it back', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '3', 'Bus', 'transport:transit')
    await writeIn(page, '4', 'Coffee', 'food:coffee')

    await page.locator(LIST).focus()
    const selected = page.locator(`${LIST} li[aria-selected=true]`)
    expect(await selected.innerText()).toContain('Coffee')
    expect(await selected.innerText()).toContain('R')

    await page.keyboard.press('r')
    await expect.poll(() => page.locator(REFILE).isVisible()).toBe(true)
    // At the row's level, its To in the picker.
    await expect.poll(() => offered(page)).toEqual(['expenses:food:coffee'])

    await page.keyboard.type('trans')
    await expect.poll(() => offered(page)).toEqual(['expenses:transport:transit'])
    await page.keyboard.press('Enter')

    await expect.poll(() => row(page, 'Coffee').innerText()).toContain('transport:transit')
    expect(await selected.innerText()).toContain('Coffee')

    await page.locator(LIST).focus()
    await page.keyboard.press('Control+z')
    await expect.poll(() => row(page, 'Coffee').innerText()).toContain('food:coffee')
  })

  test('R and P typed in a field are letters, never Refile or Show postings', async () => {
    const { page, press } = await launch(aHome())
    await writeIn(page, '4', 'Coffee', 'food:coffee')
    await openComposer(page)
    await page.focus(`${WRITE} input[name=description]`)

    // Through xdotool, as the menu would see them.
    press('r')
    press('p')
    await expect.poll(() => page.inputValue(`${WRITE} input[name=description]`)).toBe('rp')
    expect(await page.locator(REFILE).count()).toBe(0)
  })

  test('Esc closes the picker and gives the list its cursor, and arrows select rows', async () => {
    const { page } = await launch(aHome())
    await writeIn(page, '3', 'Bus', 'transport:transit')
    await writeIn(page, '4', 'Coffee', 'food:coffee')
    await page.locator(LIST).focus()
    expect(await page.locator(`${LIST} li[aria-selected=true]`).innerText()).toContain('Coffee')

    await page.keyboard.press('r')
    await expect.poll(() => page.locator(OPTIONS).isVisible()).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator(REFILE).isVisible()).toBe(false)
    expect(
      await page.evaluate(() => {
        const el = document.activeElement
        return `${el?.tagName} ${el?.getAttribute('role')} ${el?.getAttribute('aria-label')}`
      }),
    ).toBe('OL listbox Ledger')

    await page.keyboard.press('ArrowDown')
    expect(await page.locator(`${LIST} li[aria-selected=true]`).innerText()).toContain('Bus')
  })
})
