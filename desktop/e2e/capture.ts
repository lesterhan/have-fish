// Screenshots every place and state of the built app, for design work: empty, then a month in,
// with a row selected, a spend open and being changed, refused, a picker open, narrow, at 200%,
// and dark. Then the parts sheet, light and dark.
// `bun run capture`, under `xvfb-run -a` with `NO_SANDBOX=1` on Linux; never part of CI.
// The shots go to `SHOTS`, or `shots/` here. Run it on two branches the same day to compare.

import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, type Page } from 'playwright-core'
import { expect, test } from 'vitest'
import { ADD_ACCOUNT, aHome, launch, openChip, openSpend, PANE, WRITE, writeDown } from './app'
import { seed } from './month'

const out = resolve(process.env.SHOTS ?? join(import.meta.dirname, '..', 'shots'))

const NAV = 'nav[aria-label=Places]'
const SPENDS = 'ol[aria-label=Ledger]'
const ACCOUNTS = 'ol[aria-label=Accounts]'
const PALETTE = 'role=dialog[name="Do anything"]'
const BREAKDOWN = 'ol[aria-label="Spending by category"]'
const REPORTED = 'ol[aria-label="Its spends"]'

/** A laptop screen; the size the window opens; half of one, which is narrow; and 200%. */
const WIDE = { width: 1280, height: 800, scale: 1 }
const OPENS = { width: 960, height: 720, scale: 1 }
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

  await go(page, 'Ledger')
  const written = await seed(page)
  // Each account's starting balance is a transaction too. The list draws only what's in view,
  // and each row says how many there are.
  const size = () => page.locator(`${SPENDS} li`).first().getAttribute('aria-setsize')
  await expect.poll(size, { timeout: 30_000 }).toBe(String(written + 5))

  // Opened again a month in, as it is each day.
  await first.quit()
  const second = await launch(home)
  page = second.page
  shot = await shooter(page)
  await shot.size(WIDE)
  await page.waitForSelector(`${SPENDS} li`)

  // Spends.
  await shot.take('spends')
  // Scrolled: the top row's band stays while its rows pass under it.
  // The list scrolls in its scroller, which holds the listbox and an open spend's details.
  const scroll = (to: number) =>
    page.locator(SPENDS).evaluate((list, to) => {
      if (list.parentElement) list.parentElement.scrollTop = to
    }, to)
  await scroll(300)
  await shot.take('spends-scrolled')
  await scroll(0)
  await page.click(`${SPENDS} li >> nth=2`)
  await shot.take('spends-selected')
  await shot.dark('spends-selected')
  // Opened: the details under the row, lifted with it, and the rest stepped back.
  await openSpend(page.locator(`${SPENDS} li >> nth=2`))
  await shot.take('spends-card')
  await shot.dark('spends-card')
  await openChip(page, 'description')
  await page.fill(`${PANE} input[name=description]`, 'Groceries for the week, and flowers')
  await openChip(page, 'amount')
  await page.fill(`${PANE} input[name=amount]`, '12x')
  await page.press(`${PANE} input[name=amount]`, 'Enter')
  await page.waitForSelector(`${PANE} [role=alert]`)
  await shot.take('spends-card-refused')
  // Esc on the refused chip puts it back; Esc again closes the details.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.click(`${WRITE} input[name=to]`)
  await page.keyboard.type('fo')
  await shot.take('spends-picker')
  await page.keyboard.press('Escape')
  await page.fill(`${WRITE} input[name=to]`, '')
  const today = await page.inputValue(`${WRITE} input[name=date]`)
  await page.fill(`${WRITE} input[name=date]`, 'mon')
  await shot.take('spends-date')
  await page.fill(`${WRITE} input[name=date]`, today)

  // The palette, Ctrl+K: over the blurred, dimmed ledger; the letters typed marked; none.
  await page.mouse.move(0, 0)
  second.press('ctrl+k')
  await page.waitForSelector(PALETTE)
  await page.waitForFunction(() => document.getAnimations().length === 0)
  await shot.take('palette')
  await shot.dark('palette')
  await page.keyboard.type('n')
  await shot.take('palette-typed')
  await page.keyboard.type('zqx')
  await shot.take('palette-none')
  await page.keyboard.press('Escape')
  await page.waitForSelector(PALETTE, { state: 'detached' })

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
  await openSpend(page.locator(`${REPORTED} li >> nth=0`), 'section[aria-label="The spend picked"]')
  await shot.take('reports-spend')

  // The size the window opens: the form beside the list leaves it narrow, and Reports' half more so.
  await shot.size(OPENS)
  await shot.take('opens-reports')
  await go(page, 'Accounts')
  await shot.take('opens-accounts')
  await go(page, 'Ledger')
  await shot.take('opens-spends')
  await openSpend(page.locator(`${SPENDS} li >> nth=2`))
  await shot.take('opens-spends-card')
  await page.keyboard.press('Escape')

  // Half a screen: a spend opens in place just the same.
  await shot.size(NARROW)
  await go(page, 'Ledger')
  await shot.take('narrow-spends')
  await openSpend(page.locator(`${SPENDS} li >> nth=2`))
  await page.waitForTimeout(300)
  await shot.take('narrow-spends-card')
  await page.keyboard.press('Escape')
  await go(page, 'Accounts')
  await shot.take('narrow-accounts')
  await go(page, 'Reports')
  await shot.take('narrow-reports')

  // 200%.
  await shot.size(ZOOMED)
  await go(page, 'Ledger')
  await shot.take('zoom-spends')
  await go(page, 'Accounts')
  await shot.take('zoom-accounts')
  await go(page, 'Reports')
  await shot.take('zoom-reports')

  // Refused, last: the refusal stays until the next spend is written.
  await shot.size(WIDE)
  await go(page, 'Ledger')
  await writeDown(page, 'abc', 'Coffee')
  await page.waitForSelector('#amount-error')
  await shot.take('spends-refused')
})

test('the parts sheet, light and dark', { timeout: 60_000 }, async () => {
  mkdirSync(out, { recursive: true })
  // Its own entry, never the app's window: `bun run capture` builds sheet-out/ first.
  const sheet = await electron.launch({
    args: [
      join(import.meta.dirname, 'sheet-main.ts'),
      ...(process.env.NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, NODE_OPTIONS: '' },
  })
  try {
    const page = await sheet.firstWindow()
    await page.waitForSelector('main h1')
    const shot = await shooter(page)
    await shot.size({ width: 1280, height: 2300, scale: 1 })
    await shot.take('sheet')
    await shot.dark('sheet')

    // What can't be drawn at rest: the first button focused from the keyboard, the second hovered,
    // then held down.
    const buttons = page.locator('section[aria-label=Button]')
    await page.keyboard.press('Tab')
    const hovered = await buttons.getByRole('button').nth(1).boundingBox()
    if (hovered === null) throw new Error('the sheet has no second button')
    await page.mouse.move(hovered.x + hovered.width / 2, hovered.y + hovered.height / 2)
    await buttons.screenshot({ path: join(out, 'sheet-button-focus-hover.png') })
    await page.mouse.down()
    await buttons.screenshot({ path: join(out, 'sheet-button-pressed.png') })
    await page.mouse.up()
  } finally {
    await sheet.close()
  }
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
