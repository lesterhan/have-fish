// Choosing how densely the ledger is set: the row heights, the day's band, the type, and what a
// list already scrolled does when one is picked. Keys go through xdotool, so the menu and Ctrl+K
// see them as a person's would.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, type Running, settingsDirIn, writeDown } from './app'

const LEDGER = 'ol[aria-label=Ledger]'
const PALETTE = 'role=dialog[name="Do anything"]'
const INPUT = `${PALETTE} >> input[name=palette]`

const settingsIn = (home: string) => join(settingsDirIn(home), 'settings.json')
const settle = (page: Page) => page.waitForTimeout(400)

/** What the list draws: the shortest row's height, the day's band, and the body's type. */
const measured = (page: Page) =>
  page.evaluate((list) => {
    const rows = [...document.querySelectorAll<HTMLElement>(`${list} li[role=option]`)]
    const band = document.querySelector<HTMLElement>(`${list} li[role=option] > div`)
    return {
      // A row that starts a day carries its band too, so the shortest is a plain row's.
      row: Math.round(Math.min(...rows.map((r) => r.getBoundingClientRect().height))),
      band: Math.round(band?.getBoundingClientRect().height ?? 0),
      type: Math.round(Number.parseFloat(getComputedStyle(document.body).fontSize)),
    }
  }, LEDGER)

/** The row crossing the list's top edge: where it sits, and whether the drawn rows meet. */
const atTop = (page: Page) =>
  page.evaluate((list) => {
    const ol = document.querySelector<HTMLElement>(list)
    const scroller = ol?.parentElement
    if (!ol || !scroller) return null
    const box = scroller.getBoundingClientRect()
    const rows = [...ol.querySelectorAll<HTMLElement>('li[role=option]')]
    const first = rows.find((r) => r.getBoundingClientRect().bottom > box.top + 1)
    const gaps = rows.slice(1).map((row, i) => {
      const above = rows[i]?.getBoundingClientRect().bottom ?? 0
      return Math.round(row.getBoundingClientRect().top - above)
    })
    return {
      posinset: Number(first?.getAttribute('aria-posinset')),
      top: Math.round((first?.getBoundingClientRect().top ?? 0) - box.top),
      gaps: [...new Set(gaps)],
      bottom: Math.round(box.bottom),
      height: innerHeight,
      pageScrolls: (document.scrollingElement?.scrollHeight ?? 0) > innerHeight,
    }
  }, LEDGER)

/** View, Density, then the choice at `index` from 1: Compact, Regular, Comfortable, Large. */
async function chooseDensity(app: Running, page: Page, index: number) {
  app.press('alt+v')
  await settle(page)
  app.press('d')
  await settle(page)
  for (let i = 0; i < index; i++) app.press('Down')
  app.press('Return')
  await settle(page)
}

/** Two spends today: the first starts the day, so the second is a plain row to measure. */
async function twoSpends(page: Page) {
  await writeDown(page, '4.50', 'Coffee')
  await writeDown(page, '9.00', 'Lunch')
  await expect.poll(() => page.locator(`${LEDGER} li[role=option]`).count()).toBe(2)
}

/** Spends through the window's own commands, all today: enough to scroll past a page of them. */
async function manySpends(page: Page, n: number) {
  await page.evaluate(async (n) => {
    type Out = { ok: boolean; value: unknown }
    const bridge = (
      window as unknown as { haveFish: { invoke(name: string, input: unknown): Promise<Out> } }
    ).haveFish
    for (let i = 1; i <= n; i++) {
      const out = await bridge.invoke('spend.write', {
        amount: '1.00',
        description: `Spend ${i}`,
        to: { category: 'food' },
        date: '',
      })
      if (!out.ok) throw new Error(JSON.stringify(out))
    }
  }, n)
  await expect
    .poll(() => page.locator(`${LEDGER} li[role=option]`).first().getAttribute('aria-setsize'), {
      timeout: 30_000,
    })
    .toBe(String(n))
}

/** The end of the list: where a row has the least room below it. */
async function scrollToEnd(page: Page) {
  await page.locator(LEDGER).evaluate((ol) => {
    if (ol.parentElement) ol.parentElement.scrollTop = ol.parentElement.scrollHeight
  })
  await page.waitForFunction(
    (list) => {
      const first = document.querySelector(`${list} li[role=option]`)
      return first !== null && Number(first.getAttribute('aria-posinset')) > 100
    },
    LEDGER,
    { timeout: 30_000 },
  )
}

/** What `<html data-density>` said when the app mounted, after a load of the page from scratch. */
async function densityAtMount(page: Page): Promise<string | undefined> {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { seen: string[] }).seen = seen
    new MutationObserver(() => {
      if (document.querySelector('nav[aria-label=Places]') !== null)
        seen.push(document.documentElement.dataset.density ?? 'none')
    }).observe(document, { childList: true, subtree: true, attributes: true })
  })
  await page.reload()
  await page.waitForSelector('nav[aria-label=Places]')
  return page.evaluate(() => (window as unknown as { seen: string[] }).seen[0])
}

describe('how dense the ledger is', () => {
  test('View, Density, Large: a row is 46px, the type 16px, a day band 32px, and settings.json says large', async () => {
    const home = aHome()
    const app = await launch(home)
    await twoSpends(app.page)

    await chooseDensity(app, app.page, 4)

    await expect.poll(() => measured(app.page)).toEqual({ row: 46, band: 32, type: 16 })
    expect(JSON.parse(readFileSync(settingsIn(home), 'utf8')).density).toBe('large')
  })

  test('relaunch after Large: the rows are still 46px, and the density kept is Large', async () => {
    const home = aHome()
    const first = await launch(home)
    await twoSpends(first.page)
    await chooseDensity(first, first.page, 4)
    await expect.poll(() => measured(first.page)).toEqual({ row: 46, band: 32, type: 16 })
    await first.quit()

    const again = await launch(home)
    // Shown before App mounts (renderer/main.ts), so the first frame is at the density kept rather
    // than Regular first: no list lays out twice on launch.
    expect(await densityAtMount(again.page)).toBe('large')
    await expect.poll(() => measured(again.page)).toMatchObject({ row: 46, type: 16 })
    // The menu's tick is the menu's: menu.test.ts holds that the one in use is checked.
    expect(JSON.parse(readFileSync(settingsIn(home), 'utf8')).density).toBe('large')
  })

  test('Ctrl+K, type large, Enter: the rows are 46px', async () => {
    const { page, press } = await launch(aHome())
    await twoSpends(page)

    press('ctrl+k')
    await page.waitForSelector(INPUT)
    await page.keyboard.type('large')
    await page.keyboard.press('Enter')
    await page.waitForSelector(PALETTE, { state: 'detached' })

    await expect.poll(async () => (await measured(page)).row).toBe(46)
  })

  test('View, Density, Compact: the rows are 30px, the type 13px, a day band 26px', async () => {
    const app = await launch(aHome())
    await twoSpends(app.page)

    await chooseDensity(app, app.page, 1)

    await expect.poll(() => measured(app.page)).toEqual({ row: 30, band: 26, type: 13 })
  })

  test('View, Density, Comfortable: the rows are 40px, the type 14px, a day band 26px', async () => {
    const app = await launch(aHome())
    await twoSpends(app.page)

    await chooseDensity(app, app.page, 3)

    await expect.poll(() => measured(app.page)).toEqual({ row: 40, band: 26, type: 14 })
  })

  test('scrolled past the first page, Comfortable then Compact: the rows meet, the list stays inside the window, and the top row stays on top', {
    timeout: 180_000,
  }, async () => {
    const app = await launch(aHome())
    const page = app.page
    await manySpends(page, 150)

    // Into the second page of rows, partway down one: the list is drawn windowed, in pages.
    await page.locator(LEDGER).evaluate((ol) => {
      if (ol.parentElement) ol.parentElement.scrollTop = 26 + 110 * 33 + 15
    })
    await page.waitForFunction(
      (list) => {
        const first = document.querySelector(`${list} li[role=option]`)
        return first !== null && Number(first.getAttribute('aria-posinset')) > 100
      },
      LEDGER,
      { timeout: 30_000 },
    )
    const before = await atTop(page)
    expect(before?.posinset).toBeGreaterThan(100)
    expect(before?.pageScrolls).toBe(false)

    for (const index of [3, 1]) {
      await chooseDensity(app, page, index)
      await expect.poll(async () => (await atTop(page))?.posinset).toBe(before?.posinset)
      const after = await atTop(page)
      // The row it was on is at the top, and the rows below it start where the one above ends.
      expect(Math.abs(after?.top ?? 99)).toBeLessThanOrEqual(1)
      expect(after?.gaps).toEqual([0])
      expect(after?.bottom ?? 0).toBeLessThanOrEqual(after?.height ?? 0)
      expect(after?.pageScrolls).toBe(false)
    }
  })

  test('150 spends, scrolled to the end with row 134 on top, Regular then Large: row 134 is still on top', {
    timeout: 180_000,
  }, async () => {
    const app = await launch(aHome())
    const page = app.page
    await manySpends(page, 150)

    // The end of the list: the place a scroll set before the rows have grown is capped at the
    // height the list had, which loses the row altogether.
    await scrollToEnd(page)
    const before = await atTop(page)
    expect(before?.posinset).toBe(134)
    expect(before?.pageScrolls).toBe(false)

    await chooseDensity(app, page, 2)
    await chooseDensity(app, page, 4)

    await expect.poll(async () => (await atTop(page))?.posinset).toBe(134)
    const after = await atTop(page)
    expect(Math.abs(after?.top ?? 99)).toBeLessThanOrEqual(1)
    expect(after?.gaps).toEqual([0])
    expect(after?.bottom ?? 0).toBeLessThanOrEqual(after?.height ?? 0)
  })
})
