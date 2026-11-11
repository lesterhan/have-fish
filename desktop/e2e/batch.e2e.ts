// Writing a batch in one go, as a person does it, in the built app: the line that stays open, the
// lines it has written under it, and their landing on their days.

import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  aHome,
  BATCH,
  focusedIn,
  focusedName,
  launch,
  openComposer,
  rows,
  shownDay,
  WRITE,
} from './app'

const DAY = 86_400_000
const here = Intl.DateTimeFormat().resolvedOptions().timeZone
/** The day `n` days before today, here. */
const daysAgo = (n: number) => calendarDateAt(Date.now() - n * DAY, here)
const today = () => daysAgo(0)

const AMOUNT = `${WRITE} input[name=amount]`
const DESCRIPTION = `${WRITE} input[name=description]`
const FROM = `${WRITE} input[name=from]`
const DATE = `${WRITE} input[name=date]`
const LIST = 'ol[aria-label=Ledger]'

/** The batch's lines, newest first: what each says, and the day it carries where it says one. */
const lines = (page: Page) =>
  page.locator(`${BATCH} li`).evaluateAll((items) =>
    items.map((li) => {
      const cell = li.querySelector('[data-cell=description]')
      return {
        said: (cell?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        day: cell?.querySelector('time')?.getAttribute('datetime') ?? null,
      }
    }),
  )

/** What each line of the batch is for, newest first. */
const what = async (page: Page) => (await lines(page)).map((line) => line.said.split(' ')[0])

/** How many ledger rows are lit where they land. */
const lit = (page: Page) => page.locator(`${LIST} li[data-landed]`).count()

/** A line written as a person does: its row in the batch means the write is done. */
async function writeLine(page: Page, amount: string, description: string, date?: string) {
  const before = await page.locator(`${BATCH} li`).count()
  await openComposer(page)
  await page.fill(AMOUNT, amount)
  await page.fill(DESCRIPTION, description)
  if (date !== undefined) await page.fill(DATE, date)
  await page.locator(AMOUNT).press('Enter')
  await expect.poll(() => page.locator(`${BATCH} li`).count()).toBe(before + 1)
}

/** Spends through the window's own commands, all today: more than a page of them. */
async function manySpends(page: Page, count: number) {
  await page.evaluate(async (n) => {
    const bridge = (
      window as unknown as {
        haveFish: { invoke(name: string, input: unknown): Promise<{ ok: boolean }> }
      }
    ).haveFish
    for (let i = 1; i <= n; i++) {
      const out = await bridge.invoke('spend.write', {
        amount: '1.00',
        description: `Spend ${i}`,
        to: { category: 'food' },
        date: '',
      })
      if (!out.ok) throw new Error(`spend ${i} was refused`)
    }
  }, count)
  // A first run opens the line by itself; Esc closes it so the list shows what was written.
  if (await page.isVisible(WRITE)) await page.keyboard.press('Escape')
  await expect
    .poll(() => page.locator(`${LIST} li`).first().getAttribute('aria-setsize'), {
      timeout: 30_000,
    })
    .toBe(String(count))
}

describe('the line stays open', () => {
  test('a line written drops into Just written, and a fresh line keeps From and the date', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')

    await expect.poll(() => lines(page)).toEqual([{ said: 'Coffee ✓ Saved', day: null }])
    // The line is still open, empty but From and the date, with the cursor in Amount.
    expect(await page.inputValue(AMOUNT)).toBe('')
    expect(await page.inputValue(DESCRIPTION)).toBe('')
    expect(await page.inputValue(FROM)).toBe('cash')
    expect(await page.inputValue(DATE)).toBe('today')
    await expect.poll(() => focusedName(page)).toBe('amount')
  })

  test('the next line carries its date, and one not dated today says so in a pill', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')
    await writeLine(page, '12', 'Lunch', 'y')

    await expect.poll(() => what(page)).toEqual(['Lunch', 'Coffee'])
    const batch = await lines(page)
    expect(batch[0]?.day).toBe(daysAgo(1))
    expect(batch[0]?.said).toContain(shownDay(daysAgo(1)))
    expect(batch[1]?.day).toBeNull()
    expect(batch[0]?.said.endsWith('✓ Saved')).toBe(true)
    // The date carries over as typed, so a run of receipts stays on its day.
    expect(await page.inputValue(DATE)).toBe('y')
  })

  test('a batch open over midnight dates its pills by the new day', async () => {
    const { page } = await launch(aHome())
    const lastNight = new Date()
    lastNight.setDate(lastNight.getDate() - 1)
    lastNight.setHours(23, 59, 0, 0)
    await page.clock.setFixedTime(lastNight)
    // Main dates a line written today by its own clock, so the day before midnight is typed.
    await writeLine(page, '4.50', 'Coffee', daysAgo(1))
    await expect.poll(() => lines(page)).toEqual([{ said: 'Coffee ✓ Saved', day: null }])

    await page.clock.setFixedTime(new Date())
    await writeLine(page, '4.00', 'Tea', 'today')

    const batch = await lines(page)
    expect(batch.map((line) => line.day)).toEqual([null, daysAgo(1)])
  })

  test('the ledger steps back while the line is open', async () => {
    const { page } = await launch(aHome())
    await page.waitForSelector(WRITE)
    expect(await page.locator(`[data-dimmed] ${LIST}`).count()).toBe(1)
  })

  test('a write moves the cursor once, to Amount, so no picker loads its paths', async () => {
    const { page } = await launch(aHome())
    await openComposer(page)
    await page.fill(AMOUNT, '4.50')
    await page.fill(DESCRIPTION, 'Coffee')

    await page.evaluate(() => {
      const sees: string[] = []
      Object.assign(window, { __sees: sees })
      document.addEventListener(
        'focusin',
        (event) => {
          const name = (event.target as HTMLElement | null)?.getAttribute?.('name')
          if (name !== undefined && name !== null) sees.push(name)
        },
        true,
      )
    })
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator(BATCH).innerText()).toContain('Coffee')

    const seen = await page.evaluate(() => (window as unknown as { __sees: string[] }).__sees)
    // The one move. A picker loads its paths when it takes the cursor, so no stop, no load.
    expect(seen).toEqual(['amount'])
  })
})

describe('closing it', () => {
  test('Esc closes the line, and each row lands on its day, lit, the newest selected', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')
    await writeLine(page, '12', 'Lunch', 'y')

    await page.keyboard.press('Escape')
    await page.waitForSelector(WRITE, { state: 'detached' })

    expect(await page.locator(BATCH).count()).toBe(0)
    await expect.poll(() => lit(page)).toBe(2)
    await expect
      .poll(() => rows(page))
      .toEqual([`${shownDay(today())} | Coffee | 4.50`, `${shownDay(daysAgo(1))} | Lunch | 12.00`])
    expect(await page.locator(`${LIST} li[aria-selected=true]`).innerText()).toContain('Lunch')
    await expect.poll(() => focusedIn(page)).toBe('Ledger OL')
  })

  test('Done closes it too, and the amount typed after is a draft, not a third spend', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')
    await writeLine(page, '12', 'Lunch', 'y')
    await page.fill(AMOUNT, '7')

    await page.getByRole('button', { name: /Done/ }).click()
    await page.waitForSelector(WRITE, { state: 'detached' })

    await expect.poll(() => rows(page)).toHaveLength(2)
    await expect.poll(() => lit(page)).toBe(2)
    expect(await page.locator(BATCH).count()).toBe(0)

    await page.getByRole('button', { name: /\+ New/ }).click()
    await page.waitForSelector(WRITE)
    expect(await page.inputValue(AMOUNT)).toBe('7')
  })

  test('an Esc while the row is saving waits for it, so one Esc closes the line', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')
    await page.fill(AMOUNT, '4.00')
    await page.fill(DESCRIPTION, 'Tea')

    await page.evaluate(() => {
      const amount = document.querySelector(
        'form[aria-label="Write down a spend"] input[name=amount]',
      )
      amount?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      amount?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await page.waitForSelector(WRITE, { state: 'detached' })

    await expect.poll(() => rows(page)).toHaveLength(2)
    await expect.poll(() => lit(page)).toBe(2)
    expect(await page.locator(`${LIST} li[aria-selected=true]`).innerText()).toContain('Tea')
  })

  test('reaching for the list while a row is saving closes it once the row is in', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')
    await page.fill(AMOUNT, '4.00')
    await page.fill(DESCRIPTION, 'Tea')

    await page.evaluate(() => {
      const amount = document.querySelector(
        'form[aria-label="Write down a spend"] input[name=amount]',
      )
      amount?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      // A click reaches for the list, and the list takes the cursor first.
      const list = document.querySelector('ol[aria-label=Ledger]') as HTMLElement | null
      list?.focus()
      list?.click()
    })
    await page.waitForSelector(WRITE, { state: 'detached' })

    await expect.poll(() => rows(page)).toHaveLength(2)
    await expect.poll(() => lit(page)).toBe(2)
    expect(await page.locator(`${LIST} li[aria-selected=true]`).innerText()).toContain('Tea')
  })

  test('Esc keeps the half-typed line, and the next + New opens on it with no batch', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')
    await page.fill(AMOUNT, '7')
    await page.keyboard.press('Escape')
    await page.waitForSelector(WRITE, { state: 'detached' })
    await expect.poll(() => rows(page)).toHaveLength(1)
    expect(await page.locator(BATCH).count()).toBe(0)

    await page.getByRole('button', { name: /\+ New/ }).click()
    await page.waitForSelector(WRITE)
    expect(await page.inputValue(AMOUNT)).toBe('7')
    expect(await page.locator(BATCH).count()).toBe(0)
  })

  test('a line dated months back lands selected, in view on its day, lit', async () => {
    const { page } = await launch(aHome())
    // A ledger of more than one page, so the row's page has to be fetched before it can show.
    await manySpends(page, 120)
    const back = daysAgo(200)
    await writeLine(page, '30', 'Rent', back)
    await page.keyboard.press('Escape')
    await page.waitForSelector(WRITE, { state: 'detached' })

    await expect.poll(() => lit(page)).toBe(1)
    const row = page.locator(`${LIST} li[aria-selected=true]`)
    expect(await row.innerText()).toContain('Rent')
    expect(await row.locator('div time').getAttribute('datetime')).toBe(back)
    const inView = await page.evaluate((list) => {
      const ol = document.querySelector(list)
      const scroller = ol?.parentElement
      const selected = ol?.querySelector('li[aria-selected=true]')
      if (!scroller || !selected) return false
      const box = selected.getBoundingClientRect()
      const seen = scroller.getBoundingClientRect()
      return box.top >= seen.top - 1 && box.bottom <= seen.bottom + 1
    }, LIST)
    expect(inView).toBe(true)
  })

  test('a row landed off screen does not light later, once the first light has gone', async () => {
    const { page } = await launch(aHome())
    await manySpends(page, 120)
    await writeLine(page, '4.50', 'Coffee')
    await writeLine(page, '30', 'Rent', daysAgo(200))
    await page.keyboard.press('Escape')
    await page.waitForSelector(WRITE, { state: 'detached' })
    // The list holds the newest row, months back: Coffee is on the page it let go.
    await expect.poll(() => lit(page)).toBe(1)
    await page.waitForFunction(() => document.getAnimations().length === 0)

    await page.locator(LIST).evaluate((ol) => {
      if (ol.parentElement) ol.parentElement.scrollTop = 0
    })
    await expect
      .poll(() => page.locator(`${LIST} li`).first().getAttribute('aria-posinset'))
      .toBe('1')
    expect(await page.locator(`${LIST} li`, { hasText: 'Coffee' }).count()).toBe(1)
    expect(await lit(page)).toBe(0)
  })

  test('eight lines: Just written scrolls, the newest in view, and the page does not', async () => {
    const { page } = await launch(aHome())
    for (let n = 1; n <= 8; n++) await writeLine(page, String(n), `Spend ${n}`)

    expect(await page.locator(`${BATCH} li`).count()).toBe(8)
    const box = await page.locator(BATCH).evaluate((batch) => ({
      scroll: batch.scrollHeight,
      client: batch.clientHeight,
      top: batch.scrollTop,
    }))
    expect(box.scroll).toBeGreaterThan(box.client)
    expect(box.top).toBe(0)
    expect((await lines(page))[0]?.said).toContain('Spend 8')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
      ),
    ).toBeLessThanOrEqual(0)
  })
})

describe('undo in and out of the batch', () => {
  test('with the line open and nothing typed, Ctrl+Z takes the newest line out of the batch', async () => {
    const { page, press } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')
    await writeLine(page, '12', 'Lunch', 'y')

    press('ctrl+z')
    await expect.poll(() => what(page)).toEqual(['Coffee'])
    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])

    press('ctrl+shift+z')
    await expect.poll(() => what(page)).toEqual(['Lunch', 'Coffee'])
  })

  test('after Esc, Ctrl+Z takes back one line at a time, newest first', async () => {
    const { page, press } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')
    await writeLine(page, '12', 'Lunch', 'y')
    await page.keyboard.press('Escape')
    await page.waitForSelector(WRITE, { state: 'detached' })
    await expect.poll(() => rows(page)).toHaveLength(2)

    press('ctrl+z')
    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])
    press('ctrl+z')
    await expect.poll(() => rows(page)).toEqual([])
  })
})

describe('a line that is refused', () => {
  test('nothing drops, and Just written keeps what it had', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')

    await page.fill(AMOUNT, 'abc')
    await page.locator(AMOUNT).press('Enter')

    await expect.poll(() => page.locator(`${WRITE} [role=alert]`).innerText()).toBe('not an amount')
    expect(await page.getAttribute(AMOUNT, 'aria-invalid')).toBe('true')
    expect(await what(page)).toEqual(['Coffee'])
  })

  test('an Esc while it saves is dropped, and the line stays open on the refusal', async () => {
    const { page } = await launch(aHome())
    await writeLine(page, '4.50', 'Coffee')
    await page.fill(AMOUNT, 'abc')

    await page.evaluate(() => {
      const amount = document.querySelector(
        'form[aria-label="Write down a spend"] input[name=amount]',
      )
      amount?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      amount?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    await expect.poll(() => page.locator(`${WRITE} [role=alert]`).innerText()).toBe('not an amount')
    expect(await page.getAttribute(AMOUNT, 'aria-invalid')).toBe('true')
    await expect.poll(() => focusedName(page)).toBe('amount')
    expect(await what(page)).toEqual(['Coffee'])
    expect(await lit(page)).toBe(0)
  })
})
