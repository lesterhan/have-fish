// Writing down a spend, as a person does it, in the built app.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { calendarDateAt } from '@have-fish/core/calendar-date'
import { describe, expect, test } from 'vitest'
import { aHome, commandFor, launch, ledgerDirIn, rows, WRITE, writeDown } from './app'

const AMOUNT = `${WRITE} input[name=amount]`
const DESCRIPTION = `${WRITE} input[name=description]`

const today = () => calendarDateAt(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

describe('write down a spend', () => {
  test('the amount field is ready to type into when the app opens', async () => {
    const { page } = await launch(aHome())
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('amount')
  })

  test('an amount, what it was for, Enter: it is at the top of the list, dated today', async () => {
    const { page } = await launch(aHome())

    await writeDown(page, '12', 'Lunch')
    await expect.poll(() => rows(page)).toEqual([`${today()} | Lunch | 12.00 CAD`])
    await writeDown(page, '4.50', 'Coffee')

    await expect
      .poll(() => rows(page))
      .toEqual([`${today()} | Coffee | 4.50 CAD`, `${today()} | Lunch | 12.00 CAD`])
    // Cleared and ready for the next one.
    expect(await page.inputValue(AMOUNT)).toBe('')
    expect(await page.inputValue(DESCRIPTION)).toBe('')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('amount')
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
        `${today()} | Three | 3.00 CAD`,
        `${today()} | Two | 2.00 CAD`,
        `${today()} | One | 1.00 CAD`,
      ])
    expect(existsSync(join(ledgerDirIn(home), 'ledger.sqlite'))).toBe(true)
  })

  test('something that is not an amount: nothing is saved, and the field says why', async () => {
    const { page } = await launch(aHome())

    await writeDown(page, 'abc', 'Coffee')

    const error = page.locator('#amount-error')
    await expect.poll(() => error.textContent()).toMatch(/isn't an amount/)
    expect(await page.getAttribute(AMOUNT, 'aria-invalid')).toBe('true')
    expect(await page.getAttribute(AMOUNT, 'aria-describedby')).toBe('amount-error')
    expect(await rows(page)).toEqual([])
    // What was typed stays, to be fixed.
    expect(await page.inputValue(AMOUNT)).toBe('abc')
    expect(await page.inputValue(DESCRIPTION)).toBe('Coffee')
  })

  test('fixing the amount clears the message and saves', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '0', 'Coffee')
    await expect.poll(() => page.locator('#amount-error').textContent()).toMatch(/more than zero/)

    await page.fill(AMOUNT, '4.50')
    await page.press(AMOUNT, 'Enter')

    await expect.poll(() => rows(page)).toEqual([`${today()} | Coffee | 4.50 CAD`])
    expect(await page.locator('#amount-error').count()).toBe(0)
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
