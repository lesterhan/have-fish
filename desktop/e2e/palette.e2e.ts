// Ctrl+K's palette, as a person uses it, in the built app: Entry-19's acceptance. Ctrl+K goes
// through xdotool, as the menu's keys do; the rest is typed into the palette.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { copy } from '../copy'
import { aHome, focusedIn, launch, openSpend, rows, WRITE, writeDown } from './app'

const PALETTE = 'role=dialog[name="Do anything"]'
const INPUT = `${PALETTE} >> input[name=palette]`
const LIST = `${PALETTE} >> ol[aria-label=Actions]`

/** Each action listed, under its heading: `Actions: New spend Ctrl+N`. */
const listed = (page: Page) =>
  page.locator(`${LIST} [role=option]`).evaluateAll((items) => {
    let heading = ''
    return items.map((li) => {
      const band = li.querySelector(':scope > div')
      heading = band?.textContent?.trim() ?? heading
      const cells = [...li.children].filter((c) => c !== band)
      return `${heading}: ${cells
        .map((c) => c.textContent?.trim())
        .filter(Boolean)
        .join(' ')}`
    })
  })

async function open(page: Page, press: (keys: string) => void) {
  press('ctrl+k')
  await page.waitForSelector(INPUT)
  await expect.poll(() => focusedIn(page)).toBe('Do anything palette')
}

describe('do anything from Ctrl+K', () => {
  test('it opens over the dimmed window with every action, under headings, each with its keys', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await open(page, press)

    const all = await listed(page)
    expect(all.slice(0, 5)).toEqual([
      'Actions: New spend Ctrl+N',
      'Actions: Add account Ctrl+Shift+N',
      // Undo names its step, as the menu does.
      'Actions: Undo write Coffee Ctrl+Z',
      'Actions: Redo Ctrl+Shift+Z',
      'Actions: Remove spend Delete',
    ])
    expect(all).toContain('Go to: Reports Ctrl+3')
    expect(all).toContain('Settings: Follow the system')
    // The window behind is blurred and dimmed.
    const behind = await page
      .locator(PALETTE)
      .evaluate((panel) => getComputedStyle(panel.parentElement as Element).backdropFilter)
    expect(behind).toMatch(/blur/)
  })

  test('typing lists the actions with those letters in order; Enter runs one and closes it', async () => {
    const { page, press } = await launch(aHome())
    await open(page, press)

    await page.keyboard.type('acc')
    await expect
      .poll(() => listed(page))
      .toEqual(['Actions: Add account Ctrl+Shift+N', 'Go to: Accounts Ctrl+2'])
    // The letters typed are marked.
    expect(await page.locator(`${LIST} [role=option] mark`).first().textContent()).toBe('A')

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    await page.waitForSelector(PALETTE, { state: 'detached' })
    await expect.poll(() => page.isVisible('ol[aria-label=Accounts]')).toBe(true)
  })

  test('no action has the letters: it says so', async () => {
    const { page, press } = await launch(aHome())
    await open(page, press)

    await page.keyboard.type('zqx')

    await expect
      .poll(() => page.locator(PALETTE).innerText())
      .toContain('No action has those letters.')
    expect(await page.locator(`${LIST} [role=option]`).count()).toBe(0)
  })

  test('Esc closes it and the cursor goes back where it was', async () => {
    const { page, press } = await launch(aHome())
    await page.locator(`${WRITE} input[name=description]`).focus()

    await open(page, press)
    await page.keyboard.type('led')
    await page.keyboard.press('Escape')

    await page.waitForSelector(PALETTE, { state: 'detached' })
    await expect.poll(() => focusedIn(page)).toBe('Write down a spend description')
  })

  test('Show or hide postings and Refile spend act on the spend selected', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await openSpend(page.locator('ol[aria-label=Ledger] li', { hasText: 'Lunch' }))

    await open(page, press)
    await page.keyboard.type('postings')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.getByLabel(copy.spends.card.postings).isVisible()).toBe(true)

    await open(page, press)
    await page.keyboard.type('refile')
    await page.keyboard.press('Enter')
    await expect.poll(() => focusedIn(page)).toBe('Ledger to')
  })

  test('Enter on a setting runs it: the theme changes, and the palette closes', async () => {
    const { page, press } = await launch(aHome())
    await open(page, press)

    await page.keyboard.type('graphite dark')
    await page.keyboard.press('Enter')

    await page.waitForSelector(PALETTE, { state: 'detached' })
    await expect
      .poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
      .toBe(true)
  })
})
