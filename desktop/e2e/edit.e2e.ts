// Fixing a spend from its sentence in the built app: each part a chip, a change saved at once,
// undo takes it back, and a refusal keeps the chip open saying why. Entry-18's acceptance, and
// Entry-21's, which opened the details where the spend sits.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { copy } from '../copy'
import { postingsText } from '../renderer/postings'
import {
  aHome,
  chip,
  focusedIn,
  focusedLabel,
  focusedName,
  launch,
  openChip,
  openComposer,
  openSelected,
  openSpend,
  PANE,
  rows,
  shownDay,
  WRITE,
  writeDown,
} from './app'

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

const LIST = 'ol[aria-label=Ledger]'
const SELECTED = `${LIST} li[aria-selected=true]`
const AMOUNT = `${PANE} input[name=amount]`
const DESCRIPTION = `${PANE} input[name=description]`
const W_AMOUNT = `${WRITE} input[name=amount]`

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
const isOpen = (page: Page) => page.locator(PANE).isVisible()
/** What a chip reads at rest. */
const chipText = (page: Page, part: string) =>
  page
    .locator(chip(part))
    .innerText()
    .then((text) => text.replace('✓', '').replace(/\s+/g, ' ').trim())

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
  test('the newest is selected when the app opens; Enter opens it, on its words', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    expect(await page.textContent(SELECTED)).toContain('Coffee')
    expect(await isOpen(page)).toBe(false)
    await openSelected(page)
    await expect.poll(() => focusedLabel(page)).toBe('What for')
    expect(await chipText(page, 'description')).toBe('Coffee')
    expect(await chipText(page, 'amount')).toContain('4.50')
  })

  test('change the amount, Enter: it saves at once, and the row shows it', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await openSpend(row(page, 'Lunch'))
    await openChip(page, 'amount')
    await page.fill(AMOUNT, '15')
    await page.press(AMOUNT, 'Enter')

    await expect
      .poll(() => rows(page))
      .toEqual([`${shownDay(today())} | Coffee | 4.50`, `${shownDay(today())} | Lunch | 15.00`])
    expect(await chipText(page, 'amount')).toContain('15.00')
    expect(await isOpen(page)).toBe(true)
  })

  test('change what it was for, Enter: it saves at once, and the row shows it', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)

    await openSpend(row(page, 'Lunch'))
    await openChip(page, 'description')
    await page.fill(DESCRIPTION, 'Lunch with Sam')
    await page.press(DESCRIPTION, 'Enter')

    await expect
      .poll(() => rows(page))
      .toEqual([
        `${shownDay(today())} | Coffee | 4.50`,
        `${shownDay(today())} | Lunch with Sam | 12.00`,
      ])
    expect(await page.textContent(SELECTED)).toContain('Lunch with Sam')
  })

  test('the foot says it was written by hand, when, and on this computer', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    await openSelected(page)

    await expect.poll(() => page.getByText(/^Written by hand · /).isVisible()).toBe(true)
    await expect.poll(() => page.getByText(/ · this computer$/).isVisible()).toBe(true)
  })

  test('P shows the postings, balanced, and Copy puts the same text on the clipboard', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)
    // Opened by clicking its row: the cursor stays on the row, and P still reaches the details.
    await openSpend(row(page, 'Lunch'))

    await page.keyboard.press('p')
    const postings = page.getByLabel(copy.spends.card.postings)
    await expect.poll(() => postings.isVisible()).toBe(true)
    expect(await postings.innerText()).toContain('expenses:unsorted')
    expect(await postings.innerText()).toContain('12.00 CAD')
    expect(await page.getByLabel(copy.spends.card.balanced('CAD')).isVisible()).toBe(true)

    const legs = [
      { amount: '12.00', currency: 'CAD', path: 'expenses:unsorted' },
      { amount: '-12.00', currency: 'CAD', path: 'assets:cash' },
    ]
    const expected = postingsText(
      { date: today(), description: 'Lunch', legs },
      copy.spends.card.missingAccount,
    )
    await page.getByRole('button', { name: copy.spends.card.copy }).click()
    await expect
      .poll(() => page.getByRole('button', { name: copy.spends.card.copied }).isVisible())
      .toBe(true)

    // Paste it into a field of the test's own: what the clipboard holds, as the system gives it.
    await page.evaluate(() => {
      const area = document.createElement('textarea')
      area.id = 'clipboard-check'
      document.body.append(area)
      area.focus()
    })
    await page.keyboard.press('Control+V')
    expect(await page.inputValue('#clipboard-check')).toBe(expected)

    // Esc puts the postings away first; the details stay open.
    await page.getByRole('button', { name: copy.spends.card.postings }).focus()
    await page.keyboard.press('Escape')
    await expect.poll(() => postings.isVisible()).toBe(false)
    expect(await isOpen(page)).toBe(true)
  })

  test('Esc on a chip puts back what was typed and closes it; Esc again closes the details', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    await openSelected(page)

    await openChip(page, 'description')
    await page.fill(DESCRIPTION, 'Not coffee')
    await page.keyboard.press('Escape')

    expect(await chipText(page, 'description')).toBe('Coffee')
    expect(await isOpen(page)).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => isOpen(page)).toBe(false)
    await expect.poll(() => focusedName(page)).toBe('OL')
    expect(await page.textContent(SELECTED)).toContain('Coffee')
    expect(await rows(page)).toEqual([
      `${shownDay(today())} | Coffee | 4.50`,
      `${shownDay(today())} | Lunch | 12.00`,
    ])
  })

  test('something that is not an amount: the chip stays open, underlined, saying why', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    await openSelected(page)
    await openChip(page, 'amount')

    await page.fill(AMOUNT, 'abc')
    await page.press(AMOUNT, 'Enter')

    await expect
      .poll(() => page.locator(`${PANE} [role=alert]`).innerText())
      .toMatch(/isn't an amount/)
    expect(await page.getAttribute(AMOUNT, 'aria-invalid')).toBe('true')
    expect(await page.inputValue(AMOUNT)).toBe('abc')
    expect(await page.locator(chip('amount')).count()).toBe(0)
    expect(await rows(page)).toEqual([
      `${shownDay(today())} | Coffee | 4.50`,
      `${shownDay(today())} | Lunch | 12.00`,
    ])

    // Esc puts the chip back; nothing was saved.
    await page.keyboard.press('Escape')
    expect(await chipText(page, 'amount')).toContain('4.50')
    expect(await page.locator(`${PANE} [role=alert]`).count()).toBe(0)
  })

  test('from the keyboard: Enter opens a chip, its editor takes the cursor, Enter saves', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    await openSelected(page)
    await expect.poll(() => focusedLabel(page)).toBe('What for')

    await page.keyboard.press('Enter')
    expect(await page.inputValue(DESCRIPTION)).toBe('Coffee')
    await page.keyboard.press('End')
    await page.keyboard.type(' and cake')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await rows(page))[0]).toContain('Coffee and cake')
    expect(await chipText(page, 'description')).toBe('Coffee and cake')
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
    expect(await chipText(page, 'description')).toBe('Lunch')

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
    expect(await chipText(page, 'description')).toBe('Coffee')
    const at = await placed(page)
    expect(Math.abs((at.card?.top ?? 0) - (at.row?.bottom ?? 0))).toBeLessThanOrEqual(1)
    expect(at.card?.left).toBeGreaterThanOrEqual(at.list?.left ?? 0)
    expect(at.card?.right).toBeLessThanOrEqual(at.list?.right ?? 0)
    // Nothing slides over the list: the line that writes one is closed.
    expect(await page.locator('form[aria-label="Write down a spend"]').count()).toBe(0)
  })

  test('details taller than a narrow list: the row stays in view above them', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 420, height: 700 })
    await twoSpends(page)
    await row(page, 'Lunch').click()

    await openSelected(page)
    expect(await chipText(page, 'description')).toBe('Lunch')
    const at = await placed(page)
    const band = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--band')),
    )
    // Below the day's band that stays at the top of the list, and inside it.
    expect(at.row?.top).toBeGreaterThanOrEqual((at.list?.top ?? 0) + band - 1)
    expect(at.row?.bottom).toBeLessThanOrEqual(at.list?.bottom ?? 0)
  })

  test('one click on the row whose details were open last only selects it', async () => {
    const { page } = await launch(aHome())
    await twoSpends(page)
    await openSpend(row(page, 'Lunch'))

    await row(page, 'Coffee').click()
    expect(await isOpen(page)).toBe(false)
    await row(page, 'Lunch').click()
    expect(await page.textContent(SELECTED)).toContain('Lunch')
    expect(await isOpen(page)).toBe(false)
  })

  test('scrolled pages away from an open spend, its details stay open with the cursor in them', {
    timeout: 30_000,
  }, async () => {
    const { page } = await launch(aHome())
    // Three pages of the ledger's list, so scrolling drops the page the open spend is on.
    await manySpends(page, 300)
    // Writing through the commands leaves the first run's line open; close it as a click would.
    if (await page.isVisible('form[aria-label="Write down a spend"]')) {
      await page.keyboard.press('Escape')
    }
    await expect.poll(async () => (await rows(page)).length).toBeGreaterThan(0)

    await openSelected(page)
    await openChip(page, 'description')
    const was = await page.inputValue(DESCRIPTION)
    await page.click(DESCRIPTION)
    await page.keyboard.press('End')
    const scroll = (to: number) =>
      page.locator(LIST).evaluate((ol, to) => {
        const scroller = ol.parentElement as HTMLElement
        scroller.scrollTop = to < 0 ? scroller.scrollHeight : to
      }, to)

    await scroll(-1)
    // The last page has drawn, so the store has let go of every page it doesn't hold.
    await page.waitForFunction((list) => {
      const last = document.querySelector(`${list} li:last-of-type`)
      return (
        last !== null && last.getAttribute('aria-posinset') === last.getAttribute('aria-setsize')
      )
    }, LIST)
    await page.keyboard.type(' typed')
    await scroll(0)

    expect(await isOpen(page)).toBe(true)
    await expect.poll(() => focusedName(page)).toBe('description')
    expect(await page.inputValue(DESCRIPTION)).toBe(`${was} typed`)
  })

  test('a change that moves an open spend onto another drawn page keeps its details', {
    timeout: 30_000,
  }, async () => {
    const { page } = await launch(aHome())
    // Two full pages of the ledger, all today: row 95 sits on the first, and a day earlier it
    // moves onto the second, which is drawn because the view spans the boundary.
    await manySpends(page, 110)
    if (await page.isVisible('form[aria-label="Write down a spend"]')) {
      await page.keyboard.press('Escape')
    }
    await expect.poll(async () => (await rows(page)).length).toBeGreaterThan(0)
    const scroll = (to: number) =>
      page.locator(LIST).evaluate((ol, to) => {
        ;(ol.parentElement as HTMLElement).scrollTop = to
      }, to)
    // The band above the first row is 26px, each row 33px: row 90 at the top of the view.
    await scroll(26 + 90 * 33)
    await page.waitForSelector(`${LIST} li:has-text("Spend 20")`)

    const spend = row(page, 'Spend 15')
    await spend.click()
    await expect.poll(() => page.locator(SELECTED).innerText()).toContain('Spend 15')
    await spend.click()
    await page.waitForSelector(PANE)
    const was = await chipText(page, 'description')
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    await openChip(page, 'date')
    await page.fill(`${PANE} input[name=date]`, day)
    await page.press(`${PANE} input[name=date]`, 'Enter')
    await expect.poll(() => page.locator(chip('date')).isVisible()).toBe(true)

    // Type in the description, then scroll the list a page away.
    await openChip(page, 'description')
    await page.click(DESCRIPTION)
    await page.keyboard.press('End')
    await scroll(0)
    await page.waitForFunction((list) => {
      const first = document.querySelector(`${list} li`)
      return first !== null && first.getAttribute('aria-posinset') === '1'
    }, LIST)
    await page.keyboard.type(' typed')

    expect(await isOpen(page)).toBe(true)
    await expect.poll(() => focusedName(page)).toBe('description')
    expect(await page.inputValue(DESCRIPTION)).toBe(`${was} typed`)
  })
})

/** `n` spends through the bridge, all today, numbered so the newest is `Spend n`. */
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
}

describe('the cursor readers', () => {
  test('focusedName names the control, else its tag', async () => {
    const { page } = await launch(aHome())
    await openComposer(page)
    await page.locator(W_AMOUNT).focus()
    await expect.poll(() => focusedName(page)).toBe('amount')

    await page.locator(LIST).focus()
    await expect.poll(() => focusedName(page)).toBe('OL')
  })

  test('focusedLabel reads out what the control is called', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await openSelected(page)

    await expect.poll(() => focusedLabel(page)).toBe('What for')
  })

  test('focusedIn says where the cursor is, then its name', async () => {
    const { page, press } = await launch(aHome())
    await openComposer(page)
    await page.locator(W_AMOUNT).focus()
    await expect.poll(() => focusedIn(page)).toBe('Write down a spend amount')

    await page.locator(LIST).focus()
    await expect.poll(() => focusedIn(page)).toBe('Ledger OL')

    press('ctrl+k')
    await page.waitForSelector('role=dialog[name="Do anything"]')
    await expect.poll(() => focusedIn(page)).toBe('Do anything palette')
  })
})
