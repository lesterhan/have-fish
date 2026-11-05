// Screenshots every place and state of the built app, for design work: empty, then a month in,
// with a row selected, editing, refused, a picker open, narrow, at 200%, and dark.
// `bun run capture`, under `xvfb-run -a` with `NO_SANDBOX=1` on Linux; never part of CI.
// The shots go to `SHOTS`, or `shots/` here. Run it on two branches the same day to compare.

import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Page } from 'playwright-core'
import { expect, test } from 'vitest'
import { ADD_ACCOUNT, aHome, BACK, launch, PANE, rows, WRITE, writeDown } from './app'
import { seed } from './month'

const out = resolve(process.env.SHOTS ?? join(import.meta.dirname, '..', 'shots'))

const NAV = 'nav[aria-label=Places]'
const SPENDS = 'ol[aria-label=Spends]'
const ACCOUNTS = 'ol[aria-label=Accounts]'
const BREAKDOWN = 'ol[aria-label="Spending by category"]'
const REPORTED = 'ol[aria-label="Its spends"]'

/** A laptop screen; half of one, which is narrow; and the same screen at 200%. */
const WIDE = { width: 1280, height: 800, scale: 1 }
const NARROW = { width: 640, height: 800, scale: 1 }
// Ctrl+= five times lays out like this: half the CSS pixels, each drawn twice the size.
const ZOOMED = { width: 640, height: 400, scale: 2 }

type Size = typeof WIDE

test('every place and state', { timeout: 300_000 }, async () => {
  mkdirSync(out, { recursive: true })
  const home = aHome()
  const first = await launch(home)
  let page = first.page
  let shot = await shooter(page)
  await shot.size(WIDE)

  // Nothing written yet.
  await shot.take('spends-empty')
  await shot.dark('spends-empty')
  await go(page, 'Accounts')
  await shot.take('accounts-empty')
  await go(page, 'Reports')
  await shot.take('reports-empty')

  await go(page, 'Spends')
  const written = await seed(page)
  // Each account's starting balance is a transaction too.
  await expect.poll(async () => (await rows(page)).length, { timeout: 30_000 }).toBe(written + 5)

  // Opened again a month in, as it is each day.
  await first.quit()
  page = (await launch(home)).page
  shot = await shooter(page)
  await shot.size(WIDE)
  await page.waitForSelector(`${SPENDS} li`)

  // Spends.
  await shot.take('spends')
  await page.click(`${SPENDS} li >> nth=2`)
  await shot.take('spends-selected')
  await shot.dark('spends-selected')
  await page.fill(`${PANE} input[name=description]`, 'Groceries for the week, and flowers')
  await shot.take('spends-editing')
  await page.press(`${PANE} input[name=description]`, 'Escape')
  await page.click(`${WRITE} input[name=to]`)
  await page.keyboard.type('fo')
  await shot.take('spends-picker')
  await page.keyboard.press('Escape')
  await page.fill(`${WRITE} input[name=to]`, '')
  const today = await page.inputValue(`${WRITE} input[name=date]`)
  await page.fill(`${WRITE} input[name=date]`, 'mon')
  await shot.take('spends-date')
  await page.fill(`${WRITE} input[name=date]`, today)

  // Accounts.
  await go(page, 'Accounts')
  await shot.take('accounts')
  await page.click(`${ACCOUNTS} li:has-text("chequing")`)
  await shot.take('accounts-selected')
  await shot.dark('accounts-selected')
  await page.click(ADD_ACCOUNT)
  await shot.take('accounts-adding')
  await page.press('section[aria-label="The account"] input[name=name]', 'Enter')
  await page.waitForSelector('#account-name-error')
  await shot.take('accounts-refused')
  await page.click('section[aria-label="The account"] button:has-text("Cancel")')

  // Reports.
  await go(page, 'Reports')
  await page.waitForSelector(`${BREAKDOWN} li`)
  await shot.take('reports')
  await shot.dark('reports')
  // This week can be a day old; the one before is whole.
  await page.click('button[aria-label="The week before"]')
  await shot.take('reports-week-before')
  await page.click(`${BREAKDOWN} li:has-text("food")`)
  await shot.take('reports-drilled')
  await page.click(`${REPORTED} li >> nth=0`)
  await shot.take('reports-spend')

  // Half a screen: the pane slides over the list.
  await shot.size(NARROW)
  await go(page, 'Spends')
  await shot.take('narrow-spends')
  await page.click(`${SPENDS} li >> nth=2`)
  await page.press(SPENDS, 'Enter')
  await page.waitForTimeout(300)
  await shot.take('narrow-spends-pane')
  await page.click(`${PANE} >> ${BACK}`)
  await go(page, 'Accounts')
  await shot.take('narrow-accounts')
  await go(page, 'Reports')
  await shot.take('narrow-reports')

  // 200%.
  await shot.size(ZOOMED)
  await go(page, 'Spends')
  await shot.take('zoom-spends')
  await go(page, 'Accounts')
  await shot.take('zoom-accounts')
  await go(page, 'Reports')
  await shot.take('zoom-reports')

  // Refused, last: the refusal stays until the next spend is written.
  await shot.size(WIDE)
  await go(page, 'Spends')
  await writeDown(page, 'abc', 'Coffee')
  await page.waitForSelector('#amount-error')
  await shot.take('spends-refused')
})

async function go(page: Page, place: string) {
  await page.click(`${NAV} button:has-text("${place}")`)
}

async function shooter(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  return {
    /** The window's size in CSS pixels, and how many device pixels each takes. */
    async size({ width, height, scale }: Size) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: false,
      })
    },
    async take(name: string) {
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' })
    },
    /** The same state in the dark scheme, then back to light. */
    async dark(name: string) {
      await page.emulateMedia({ colorScheme: 'dark' })
      await this.take(`${name}-dark`)
      await page.emulateMedia({ colorScheme: 'light' })
    },
  }
}
