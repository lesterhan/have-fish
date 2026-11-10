// A long list fills the space its place gives it and scrolls inside it: the page never scrolls,
// and a list you come back to is where you left it (see #605, which drew only the rows in view).

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch } from './app'
import { seed } from './month'

const NAV = 'nav[aria-label=Places]'
const LEDGER = 'ol[aria-label=Ledger]'

/** The selected row's words, and whether it shows whole inside the list. */
const selection = (page: Page) =>
  page.evaluate((list) => {
    const ol = document.querySelector(list)
    const li = ol?.querySelector('li[aria-selected=true]')
    if (!ol || !li) return null
    const [box, row] = [ol.getBoundingClientRect(), li.getBoundingClientRect()]
    return { text: li.textContent ?? '', shows: row.top >= box.top && row.bottom <= box.bottom }
  }, LEDGER)

const go = (page: Page, place: string) => page.click(`${NAV} button:has-text("${place}")`)

/** Every list on show, by name: its bottom edge and the window's height, and if the page scrolls. */
const boxes = (page: Page) =>
  page.evaluate(() => ({
    lists: [...document.querySelectorAll<HTMLElement>('[role=listbox]')]
      .filter((l) => l.offsetParent !== null)
      .map((l) => ({
        name: l.getAttribute('aria-label'),
        bottom: Math.round(l.parentElement?.getBoundingClientRect().bottom ?? 0),
        // A list scrolls in its scroller, around the listbox and any details open in it.
        scrolls: (l.parentElement?.scrollHeight ?? 0) > (l.parentElement?.clientHeight ?? 0),
      })),
    height: innerHeight,
    pageScrolls: (document.scrollingElement?.scrollHeight ?? 0) > innerHeight,
  }))

describe('a long list', () => {
  test('stays inside the window, in every place', { timeout: 30_000 }, async () => {
    const { page } = await launch(aHome())
    const written = await seed(page)
    // Each account's starting balance is a transaction too.
    const size = () => page.locator(`${LEDGER} li`).first().getAttribute('aria-setsize')
    await expect.poll(size, { timeout: 15_000 }).toBe(String(written + 5))

    const ledger = await boxes(page)
    expect(ledger.pageScrolls).toBe(false)
    expect(ledger.lists).toContainEqual(expect.objectContaining({ name: 'Ledger', scrolls: true }))
    for (const list of ledger.lists)
      expect(list.bottom, list.name ?? '').toBeLessThanOrEqual(ledger.height)

    for (const place of ['Accounts', 'Reports']) {
      await go(page, place)
      const shown = await boxes(page)
      expect(shown.pageScrolls, place).toBe(false)
      for (const list of shown.lists) {
        expect(list.bottom, `${place}: ${list.name}`).toBeLessThanOrEqual(shown.height)
      }
    }
  })

  test('is where you left it when you come back', { timeout: 30_000 }, async () => {
    const { page } = await launch(aHome())
    const written = await seed(page)
    const size = () => page.locator(`${LEDGER} li`).first().getAttribute('aria-setsize')
    await expect.poll(size, { timeout: 15_000 }).toBe(String(written + 5))

    const list = page.locator(LEDGER)
    await list.hover()
    await page.mouse.wheel(0, 600)
    const scrolled = () => list.evaluate((l) => Math.round(l.parentElement?.scrollTop ?? 0))
    await expect.poll(scrolled).toBeGreaterThan(0)
    const at = await scrolled()
    const first = () => list.locator('li').first().getAttribute('aria-posinset')
    const firstDrawn = await first()
    expect(Number(firstDrawn)).toBeGreaterThan(1)

    await go(page, 'Accounts')
    await go(page, 'Ledger')
    await expect.poll(scrolled).toBe(at)
    await expect.poll(first).toBe(firstDrawn)
  })

  test('an undo far down the list selects what came back, and shows it', {
    timeout: 30_000,
  }, async () => {
    const { page, press } = await launch(aHome())
    const written = await seed(page)
    // Older than the month, so the list runs well past its first page.
    await page.evaluate(async () => {
      type Invoke = (name: string, input: unknown) => Promise<{ ok: boolean }>
      const bridge = (window as unknown as { haveFish: { invoke: Invoke } }).haveFish
      for (let i = 0; i < 150; i++) {
        const date = `2025-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`
        await bridge.invoke('spend.write', { amount: '1.00', description: `Old ${i}`, date })
      }
    })
    const total = written + 5 + 150
    const size = () => page.locator(`${LEDGER} li`).first().getAttribute('aria-setsize')
    await expect.poll(size, { timeout: 15_000 }).toBe(String(total))

    await page.click(`${LEDGER} li >> nth=0`)
    await page.keyboard.press('End')
    await expect
      .poll(() => selection(page))
      .toEqual({ text: expect.stringContaining('Old 0'), shows: true })

    await page.keyboard.press('Delete')
    await expect.poll(size).toBe(String(total - 1))
    await page.keyboard.press('Home')
    await expect.poll(() => selection(page).then((s) => s?.text)).not.toContain('Old')

    press('ctrl+z')
    await expect.poll(size).toBe(String(total))
    await expect
      .poll(() => selection(page))
      .toEqual({ text: expect.stringContaining('Old 0'), shows: true })
  })
})
