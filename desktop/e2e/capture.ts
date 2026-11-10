// Screenshots every place and state of the built app, for design work: empty, then a month in,
// with a row selected, a spend open and being changed, refused, a picker open, narrow, at 200%,
// and dark. Then the parts sheet, light and dark.
// `bun run capture`, under `xvfb-run -a` with `NO_SANDBOX=1` on Linux; never part of CI.
// The shots go to `SHOTS`, or `shots/` here. Run it on two branches the same day to compare.

import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, type Page } from 'playwright-core'
import { expect, test } from 'vitest'
import {
  ADD_ACCOUNT,
  aHome,
  BATCH,
  launch,
  openChip,
  openSpend,
  PANE,
  type Running,
  WRITE,
} from './app'
import { seed } from './month'

const out = resolve(process.env.SHOTS ?? join(import.meta.dirname, '..', 'shots'))
/** The palette needs a real key press through xdotool; a machine without it can skip it. */
const KEYS = process.env.SKIP_KEYS !== '1'

const NAV = 'nav[aria-label=Places]'
const SPENDS = 'ol[aria-label=Ledger]'
const ACCOUNTS = 'ol[aria-label=Accounts]'
const PALETTE = 'role=dialog[name="Do anything"]'
const TREE = 'ol[aria-label="Spending by category"]'
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
  // R: the selected row's To becomes a path picker, under the cell.
  await page.locator(SPENDS).focus()
  await page.keyboard.press('r')
  await page.waitForSelector(`${SPENDS} [role=listbox] [role=option]`)
  await shot.take('spends-refile')
  await shot.dark('spends-refile')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  // Opened: the details under the row, lifted with it, and the rest stepped back.
  await openSpend(page.locator(`${SPENDS} li >> nth=2`))
  await shot.take('spends-card')
  await shot.dark('spends-card')
  // P: the postings as text, with a balance check per currency and Copy.
  await page.keyboard.press('p')
  await shot.take('spends-card-postings')
  await shot.dark('spends-card-postings')
  await page.keyboard.press('p')
  // The path picker at the value's level, its trail above.
  await openChip(page, 'to')
  await page.waitForSelector(`${PANE} [role=listbox] [role=option]`)
  await shot.take('spends-card-picker')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
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

  // The line that writes a spend: its parts, the next one's Tab, the date list, a refusal, a picker.
  await page.getByRole('button', { name: /\+ New/ }).click()
  await page.waitForSelector(WRITE)
  await page.fill(`${WRITE} input[name=amount]`, '4.5')
  await shot.take('spends-composing')
  await shot.dark('spends-composing')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Bean There')
  await page.locator(`${WRITE} input[name=date]`).focus()
  await page.fill(`${WRITE} input[name=date]`, 'mon')
  await page.waitForSelector(`${WRITE} [role=listbox][aria-label="Days it can read"] [role=option]`)
  await page.waitForFunction(() => document.getAnimations().length === 0)
  await shot.take('spends-composer-date')
  await page.keyboard.press('Escape')

  // The line staying open: two spends drop into the batch under it, then land on their days.
  await page.getByRole('button', { name: /\+ New/ }).click()
  await page.waitForSelector(WRITE)
  await page.fill(`${WRITE} input[name=date]`, 'today')
  await page.fill(`${WRITE} input[name=amount]`, '4.50')
  await page.fill(`${WRITE} input[name=description]`, 'Coffee')
  await page.locator(`${WRITE} input[name=amount]`).press('Enter')
  await expect.poll(() => page.inputValue(`${WRITE} input[name=amount]`)).toBe('')
  await page.fill(`${WRITE} input[name=date]`, 'y')
  await page.fill(`${WRITE} input[name=amount]`, '12')
  await page.fill(`${WRITE} input[name=description]`, 'Lunch')
  await page.locator(`${WRITE} input[name=amount]`).press('Enter')
  await expect.poll(() => page.locator(BATCH).locator('li').count()).toBe(2)
  await page.waitForFunction(() => document.getAnimations().length === 0)
  await shot.take('batch-saved')
  await shot.dark('batch-saved')
  await page.keyboard.press('Escape')
  await page.waitForSelector(`${SPENDS} li[data-landed]`)
  await shot.take('batch-landed')
  await shot.dark('batch-landed')

  await page.getByRole('button', { name: /\+ New/ }).click()
  await page.waitForSelector(WRITE)
  await page.fill(`${WRITE} input[name=amount]`, '4.5x')
  await page.press(`${WRITE} input[name=amount]`, 'Enter')
  await page.waitForSelector(`${WRITE} [role=alert]`)
  await shot.take('spends-composer-refused')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /\+ New/ }).click()
  await page.waitForSelector(WRITE)
  await page.locator(`${WRITE} input[name=to]`).focus()
  await page.keyboard.type('fo')
  await page.waitForSelector(
    `${WRITE} [role=listbox][aria-label="Your categories and accounts"] [role=option]`,
  )
  await page.waitForFunction(() => document.getAnimations().length === 0)
  await shot.take('spends-composer-picker')
  await shot.dark('spends-composer-picker')
  await page.keyboard.press('Escape')

  // The palette, Ctrl+K: over the blurred, dimmed ledger; the letters typed marked; none.
  if (KEYS) {
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
  }

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
  await page.waitForSelector(`${TREE} li`)
  await shot.take('reports')
  await shot.dark('reports')
  // This week can be a day old; the one before is whole.
  await page.click('button[aria-label="The week before"]')
  await shot.take('reports-week-before')
  // Food open, with a category under it picked: its spends beside the tree.
  const food = page.locator(`${TREE} li`).filter({ hasText: 'expenses food' }).first()
  await food.click()
  await food.click()
  await page.locator(`${TREE} li`).filter({ hasText: ':restaurants' }).first().click()
  await shot.take('reports-opened')
  await openSpend(page.locator(`${REPORTED} li >> nth=0`), 'section[aria-label="The spend picked"]')
  await shot.take('reports-spend')

  // The size the window opens: the form beside the list leaves it narrow, and Reports' half more so.
  await shot.size(OPENS)
  await shot.take('opens-reports')
  await go(page, 'Accounts')
  await shot.take('opens-accounts')
  await go(page, 'Ledger')
  await shot.take('opens-spends')
  await page.getByRole('button', { name: /\+ New/ }).click()
  await page.waitForSelector(WRITE)
  await page.fill(`${WRITE} input[name=amount]`, '')
  await page.fill(`${WRITE} input[name=description]`, '')
  await page.fill(`${WRITE} input[name=date]`, 'today')
  await page.keyboard.press('Tab')
  await shot.take('opens-composer')
  await page.keyboard.press('Escape')
  await openSpend(page.locator(`${SPENDS} li >> nth=2`))
  await shot.take('opens-spends-card')
  await page.keyboard.press('Escape')

  // Density at the size the window opens: only the rows and the type move, and Large in the same
  // columns cuts more of each name.
  if (KEYS) {
    for (const density of ['compact', 'regular', 'comfortable', 'large']) {
      await pickDensity(page, second, density)
      await shot.take(`opens-density-${density}`)
    }
    // Back to Regular, so the narrow and zoomed shots keep the default.
    await pickDensity(page, second, 'regular')
  }

  // Half a screen: a spend opens in place just the same.
  await shot.size(NARROW)
  await go(page, 'Ledger')
  await shot.take('narrow-spends')
  await page.getByRole('button', { name: /\+ New/ }).click()
  await page.waitForSelector(WRITE)
  await page.fill(`${WRITE} input[name=amount]`, '')
  await page.fill(`${WRITE} input[name=description]`, '')
  await page.fill(`${WRITE} input[name=date]`, 'today')
  await page.keyboard.press('Tab')
  await shot.take('narrow-composer')
  await page.keyboard.press('Escape')
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
  await page.getByRole('button', { name: /\+ New/ }).click()
  await page.waitForSelector(WRITE)
  await page.fill(`${WRITE} input[name=amount]`, 'abc')
  await page.fill(`${WRITE} input[name=description]`, 'Coffee')
  await page.locator(`${WRITE} input[name=amount]`).press('Enter')
  await page.waitForSelector(`${WRITE} [role=alert]`)
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
    // The batch on the sheet's own today: the line dated today has no pill, the one before it does.
    const pills = page.locator('section[aria-label=Composer] ol[aria-label="Just written"] time')
    await expect.poll(() => pills.count()).toBe(1)
    expect(await pills.getAttribute('datetime')).toBe('2026-11-04')
    const shot = await shooter(page)
    await shot.size({ width: 1280, height: 2300, scale: 1 })
    await shot.take('sheet')
    await shot.dark('sheet')
    // The picker open, at a category's level.
    await page.click('section[aria-label=PathPicker] input')
    await page.waitForSelector('section[aria-label=PathPicker] [role=option]')
    await page.waitForFunction(() => document.getAnimations().length === 0)
    await shot.take('sheet-path-picker')
    await shot.dark('sheet-path-picker')
    await page.keyboard.press('Escape')
    await page.click('h1')

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

/** A density picked from Ctrl+K, as a person would: the window offers no other way from a test. */
async function pickDensity(page: Page, app: Running, density: string) {
  app.press('ctrl+k')
  await page.waitForSelector(PALETTE)
  await page.keyboard.type(density)
  await page.keyboard.press('Enter')
  await page.waitForSelector(PALETTE, { state: 'detached' })
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

async function shooter(page: Page) {
  // Design shots are light unless they say dark; the app itself follows the machine.
  await page.emulateMedia({ colorScheme: 'light' })
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
