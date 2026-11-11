// Writing down a spend, as a person does it, in the built app: the line, its parts and its keys.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { calendarDateAt } from '@have-fish/core/calendar-date'
import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import {
  aHome,
  BATCH,
  commandFor,
  focusedName,
  launch,
  ledgerDirIn,
  openComposer,
  rows,
  shownDay,
  WRITE,
  writeDown,
} from './app'
import { seed } from './month'

const AMOUNT = `${WRITE} input[name=amount]`
const DESCRIPTION = `${WRITE} input[name=description]`
const FROM = `${WRITE} input[name=from]`
const DATE = `${WRITE} input[name=date]`
const LEDGER = 'ol[aria-label=Ledger]'

/** What a part of the line reads, its Tab mark among it while that shows. */
const partText = (page: Page, part: string) => page.locator(`[data-part=${part}]`).innerText()

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

describe("a day's band", () => {
  test('says the day, and what it came to with a true minus, over its first row', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(2)

    // The band rides in the day's first row, and isn't in the second.
    const bands = page.locator(`${LEDGER} [role=option] > div`)
    await expect.poll(() => bands.allInnerTexts()).toEqual([`Today · ${shownDay(today())}\n−16.50`])
  })
})

describe('the line', () => {
  test('a fresh ledger opens it by itself, with examples in its parts', async () => {
    const { page } = await launch(aHome())
    await page.waitForSelector(WRITE)

    expect(await page.inputValue(FROM)).toBe('')
    expect(await page.inputValue(DATE)).toBe('')
    expect(await page.inputValue(AMOUNT)).toBe('')
    expect(await page.getAttribute(FROM, 'placeholder')).toBe('assets:wallet')
    expect(await page.getAttribute(DATE, 'placeholder')).toBe('today')
    expect(await page.getAttribute(AMOUNT, 'placeholder')).toBe('4.50')
    expect(await page.getAttribute(`${WRITE} input[name=description]`, 'placeholder')).toBe(
      'coffee',
    )
    expect(await page.getAttribute(`${WRITE} input[name=to]`, 'placeholder')).toBe(
      'expenses:food:coffee',
    )
    // The first empty part is where the run starts.
    await expect.poll(() => focusedName(page)).toBe('from')
    expect(await rows(page)).toEqual([])
  })

  test('+ New opens it above today, and Esc closes it without writing', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await page.getByRole('button', { name: /\+ New/ }).click()
    await page.waitForSelector(WRITE)
    const line = await page.locator(WRITE).boundingBox()
    const first = await page.locator(`${LEDGER} [role=option]`).first().boundingBox()
    expect(line?.y).toBeLessThan(first?.y ?? 0)
    expect(await page.locator(WRITE).innerText()).toContain('Done')

    await page.keyboard.press('Escape')
    await page.waitForSelector(WRITE, { state: 'detached' })
    await expect.poll(() => rows(page)).toHaveLength(1)
  })

  test('an amount, what it was for, Enter: it drops into the batch, and a fresh line opens', async () => {
    const { page } = await launch(aHome())
    await openComposer(page)

    await page.locator(AMOUNT).focus()
    await page.keyboard.type('12')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Lunch')
    await page.keyboard.press('Enter')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Lunch | 12.00`])
    // The line stays open, empty, with what it wrote in the batch under it and the cursor in Amount.
    expect(await page.locator(WRITE).count()).toBe(1)
    expect(await page.inputValue(AMOUNT)).toBe('')
    expect(await page.locator(BATCH).innerText()).toContain('Lunch')
    await expect.poll(() => focusedName(page)).toBe('amount')

    await writeDown(page, '4.50', 'Coffee')
    await expect
      .poll(() => rows(page))
      .toEqual([`${shownDay(today())} | Coffee | 4.50`, `${shownDay(today())} | Lunch | 12.00`])
  })

  test('quit and reopen: they are all still there, newest first', async () => {
    const home = aHome()
    const first = await launch(home)
    for (const [amount, description] of [
      ['1', 'One'],
      ['2', 'Two'],
      ['3', 'Three'],
    ] as const) {
      await writeDown(first.page, amount, description)
      await expect.poll(async () => (await rows(first.page))[0]).toContain(description)
    }
    await first.quit()

    const again = await launch(home)

    await expect
      .poll(() => rows(again.page))
      .toEqual([
        `${shownDay(today())} | Three | 3.00`,
        `${shownDay(today())} | Two | 2.00`,
        `${shownDay(today())} | One | 1.00`,
      ])
    expect(existsSync(join(ledgerDirIn(home), 'ledger.sqlite'))).toBe(true)
  })

  test('Tab walks the parts, and the next one carries its key', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await page.getByRole('button', { name: /\+ New/ }).click()
    await page.waitForSelector(WRITE)

    // From and Date carried over; the run starts at Amount.
    expect(await page.inputValue(FROM)).toBe('cash')
    expect(await page.inputValue(DATE)).toBe('today')
    await expect.poll(() => focusedName(page)).toBe('amount')
    await expect.poll(() => partText(page, 'amount')).toContain('Tab')

    await page.keyboard.type('7')
    await expect.poll(() => partText(page, 'description')).toContain('Tab')

    await page.keyboard.press('Tab')
    await expect.poll(() => focusedName(page)).toBe('description')
    await expect.poll(() => partText(page, 'description')).toContain('Tab')

    await page.keyboard.type('Tea')
    await expect.poll(() => partText(page, 'to')).toContain('Tab')

    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => focusedName(page)).toBe('amount')
  })

  test('Esc keeps what was typed, and the next + New opens on it', async () => {
    const { page } = await launch(aHome())
    await openComposer(page)
    await page.fill(AMOUNT, '4.50')
    await page.fill(DESCRIPTION, 'Coffee')

    await page.keyboard.press('Escape')
    await page.waitForSelector(WRITE, { state: 'detached' })
    expect(await rows(page)).toEqual([])

    await page.getByRole('button', { name: /\+ New/ }).click()
    await page.waitForSelector(WRITE)
    expect(await page.inputValue(AMOUNT)).toBe('4.50')
    expect(await page.inputValue(DESCRIPTION)).toBe('Coffee')
  })

  test('something that is not an amount: nothing is saved, and the part says why', async () => {
    const { page } = await launch(aHome())
    await openComposer(page)

    await page.locator(AMOUNT).focus()
    await page.keyboard.type('abc')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Coffee')
    await page.keyboard.press('Enter')

    const error = page.locator(`${WRITE} [role=alert]`)
    await expect.poll(() => error.textContent()).toBe('not an amount')
    expect(await page.getAttribute(AMOUNT, 'aria-invalid')).toBe('true')
    expect(await rows(page)).toEqual([])
    // What was typed stays, to be fixed.
    expect(await page.inputValue(AMOUNT)).toBe('abc')
    expect(await page.inputValue(DESCRIPTION)).toBe('Coffee')
  })

  test('fixing the amount clears the message and saves', async () => {
    const { page } = await launch(aHome())
    await openComposer(page)
    await page.fill(AMOUNT, '0')
    await page.fill(DESCRIPTION, 'Coffee')
    await page.locator(AMOUNT).press('Enter')
    await expect
      .poll(() => page.locator(`${WRITE} [role=alert]`).textContent())
      .toBe('not positive')

    await page.fill(AMOUNT, '4.50')
    await page.press(AMOUNT, 'Enter')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Coffee | 4.50`])
    expect(await page.locator(`${WRITE} [role=alert]`).count()).toBe(0)
  })

  test('Ctrl+N with the list scrolled brings today in, and the line stays through a scroll', async () => {
    const { page } = await launch(aHome())
    // The first run opens the line by itself; seeding through commands leaves it open.
    await seed(page)
    if (await page.isVisible(WRITE)) await page.keyboard.press('Escape')
    await expect.poll(async () => (await rows(page)).length).toBeGreaterThan(10)
    const scroller = page.locator(LEDGER).locator('..')
    await scroller.evaluate((list) => {
      list.scrollTop = 600
    })
    await expect.poll(() => scroller.evaluate((list) => list.scrollTop)).toBe(600)

    await page.getByRole('button', { name: /\+ New/ }).click()
    await page.waitForSelector(WRITE)
    await expect.poll(() => scroller.evaluate((list) => list.scrollTop)).toBe(0)

    await page.fill(AMOUNT, '4.50')
    await scroller.evaluate((list) => {
      list.scrollTop = 400
    })
    expect(await page.isVisible(WRITE)).toBe(true)
    expect(await page.inputValue(AMOUNT)).toBe('4.50')
    await page.keyboard.press('Escape')
  })

  test('From and the date carry over from the last line', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await page.getByRole('button', { name: /\+ New/ }).click()
    await page.waitForSelector(WRITE)

    expect(await page.inputValue(FROM)).toBe('cash')
    expect(await page.inputValue(DATE)).toBe('today')
  })
})

describe('the app', () => {
  test('a second launch quits and leaves the first one running', async () => {
    const home = aHome()
    const running = await launch(home)
    const { exe, args, env } = commandFor(home)

    const second = spawnSync(exe, args, { env, timeout: 20_000 })

    expect(second.status).toBe(0)
    expect(second.signal).toBeNull()
    expect(running.windows()).toBe(1)
    await writeDown(running.page, '4.50', 'Still here')
    await expect.poll(async () => (await rows(running.page))[0]).toContain('Still here')
  })

  test('the page has no Node, a strict policy, and nowhere else to go', async () => {
    const running = await launch(aHome())
    const { page } = running

    expect(page.url()).toBe('app://have-fish/')
    await expect.poll(() => page.title()).toBe('have-fish')
    expect(await page.evaluate(() => [typeof require, typeof process])).toEqual([
      'undefined',
      'undefined',
    ])
    expect(await page.evaluate(() => Object.keys(window.haveFish))).toEqual([
      'invoke',
      'onChanged',
      'onAction',
      'setTyping',
    ])
    const csp = await page.evaluate(async () =>
      (await fetch(location.href)).headers.get('content-security-policy'),
    )
    expect(csp).toMatch(/^default-src 'self'/)

    await page.evaluate(() => {
      location.href = 'https://example.com/'
    })
    await page.evaluate(() => window.open('https://example.com/'))
    await page.waitForTimeout(500)
    expect(page.url()).toBe('app://have-fish/')
    expect(running.windows()).toBe(1)
  })

  test('nothing outside the renderer folder is served', async () => {
    const { page } = await launch(aHome())
    const status = await page.evaluate(
      async () => (await fetch('app://have-fish/%2e%2e/main/index.js')).status,
    )
    expect(status).toBe(404)
  })
})
