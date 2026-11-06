// A long list fills the space its place gives it and scrolls inside it: the page never scrolls,
// and a list you come back to is where you left it (see #605, which drew only the rows in view).

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch } from './app'
import { seed } from './month'

const NAV = 'nav[aria-label=Places]'
const LEDGER = 'ol[aria-label=Ledger]'

const go = (page: Page, place: string) => page.click(`${NAV} button:has-text("${place}")`)

/** Every list on show, by name: its bottom edge and the window's height, and if the page scrolls. */
const boxes = (page: Page) =>
  page.evaluate(() => ({
    lists: [...document.querySelectorAll<HTMLElement>('[role=listbox]')]
      .filter((l) => l.offsetParent !== null)
      .map((l) => ({
        name: l.getAttribute('aria-label'),
        bottom: Math.round(l.getBoundingClientRect().bottom),
        scrolls: l.scrollHeight > l.clientHeight,
      })),
    height: innerHeight,
    pageScrolls: (document.scrollingElement?.scrollHeight ?? 0) > innerHeight,
  }))

describe('a long list', () => {
  test('stays inside the window, in every place', { timeout: 120_000 }, async () => {
    const { page } = await launch(aHome())
    const written = await seed(page)
    // Each account's starting balance is a transaction too.
    const size = () => page.locator(`${LEDGER} li`).first().getAttribute('aria-setsize')
    await expect.poll(size, { timeout: 30_000 }).toBe(String(written + 5))

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

  test('is where you left it when you come back', { timeout: 120_000 }, async () => {
    const { page } = await launch(aHome())
    const written = await seed(page)
    const size = () => page.locator(`${LEDGER} li`).first().getAttribute('aria-setsize')
    await expect.poll(size, { timeout: 30_000 }).toBe(String(written + 5))

    const list = page.locator(LEDGER)
    await list.hover()
    await page.mouse.wheel(0, 600)
    const scrolled = () => list.evaluate((l) => Math.round(l.scrollTop))
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
})
