// A yen spend a card kept to CAD paid, in the built app: the line asks what the card was charged,
// the row reads the yen, the card says the dollars and the rate, and the card owes the dollars,
// and Reports counts them.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { addDays, calendarDateAt } from '@have-fish/core/calendar-date'
import type { Locator, Page } from 'playwright-core'
import { describe, expect, onTestFinished, test } from 'vitest'
import { copy } from '../copy'
import {
  accountLines,
  addAccount,
  aHome,
  BEHIND,
  CONVERTED,
  chip,
  convertedLine,
  daysAgo,
  focusedIn,
  focusedLabel,
  focusedName,
  goTo,
  launch,
  openChip,
  openComposer,
  openSelected,
  PANE,
  pickPath,
  reportSums,
  reportTree,
  rows,
  shownDay,
  spendCells,
  treeRow,
  WRITE,
} from './app'

const AMOUNT = `${WRITE} input[name=amount]`
const CHARGED = `${WRITE} input[name=charged]`
/** The charged chip's field, open in the card. */
const CHARGED_FIELD = `${PANE} input[name=charged]`

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const today = () => calendarDateAt(Date.now(), ZONE)

/** A fresh app with visa, a card kept to CAD. */
async function withVisa(): Promise<Page> {
  const { page } = await launch(aHome())
  await addAccount(page, 'visa', 'card', 'CAD')
  return page
}

/** The line open, From visa, and `amount` typed in the amount, where the cursor stays. */
async function fromVisa(page: Page, amount: string) {
  await openComposer(page)
  await pickPath(page, `${WRITE} input[name=from]`, 'visa')
  await page.locator(AMOUNT).focus()
  await page.keyboard.type(amount)
}

/** ¥4,000 for dinner from visa, charged 36.20: typed, Tab by Tab, saved, and the line closed. */
async function writeDinner(page: Page) {
  await fromVisa(page, '4000 jpy')
  await page.keyboard.press('Tab')
  await page.keyboard.type('36.20')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Dinner')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForSelector(WRITE, { state: 'detached' })
}

/** A fresh app with the dinner written, its row shown. */
async function aDinner(): Promise<Page> {
  const page = await withVisa()
  await writeDinner(page)
  await expect.poll(() => rows(page)).toHaveLength(1)
  return page
}

/** 8,400 JPY from visa, its charge left to wait for the statement. */
async function aWaitingLunch(): Promise<Page> {
  const page = await withVisa()
  await fromVisa(page, '8400 jpy')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Lunch')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForSelector(WRITE, { state: 'detached' })
  await expect.poll(() => rows(page)).toHaveLength(1)
  return page
}

/**
 * `amount` from a cash wallet kept to `currency`, no rate anywhere. `on` is its day, today when
 * left out; a second spend from the wallet passes `addWallet` false.
 */
async function fromWallet(
  page: Page,
  wallet: string,
  currency: string,
  amount: string,
  on = '',
  addWallet = true,
) {
  const before = (await rows(page)).length
  if (addWallet) await addAccount(page, wallet, 'cash', currency)
  await openComposer(page)
  await pickPath(page, `${WRITE} input[name=from]`, wallet)
  await page.fill(AMOUNT, amount)
  if (on !== '') await page.fill(`${WRITE} input[name=date]`, on)
  await page.press(AMOUNT, 'Enter')
  await page.keyboard.press('Escape')
  await expect.poll(() => rows(page)).toHaveLength(before + 1)
}

/**
 * ¥1,500 from a cash wallet kept to JPY, no rate anywhere: unsorted, and worth nothing in CAD.
 * `on` is its day, today when left out; a second spend from the wallet passes `addWallet` false.
 */
async function yenFromCash(page: Page, on = '', addWallet = true) {
  await fromWallet(page, 'suica', 'JPY', '1500', on, addWallet)
}

/** The popover of the guessed rates behind a figure. */
const guesses = (page: Page) => page.getByRole('dialog', { name: copy.reports.guesses.label })

/** The Unsorted row's `cell` figure clicked, and the popover it opens. */
async function openFigure(page: Page, cell: string): Promise<Locator> {
  await treeRow(page, 'Unsorted').locator(`[data-cell=${cell}] [data-guessed]`).click()
  return guesses(page)
}

/** The rate typed in the popover's field, or the field of `currency`, and Enter. */
async function writeRate(popover: Locator, rate: string, currency?: string) {
  const field =
    currency === undefined
      ? popover.getByRole('textbox')
      : popover.getByRole('textbox', { name: new RegExp(`(^| · )${currency} · `) })
  await field.fill(rate)
  await field.press('Enter')
}

/** The popover's fields' labels, in the order they show. */
const labelsOf = (popover: Locator) => popover.locator('label').allInnerTexts()

/** Each of `found`'s texts, its white space read as one space. */
const textsOf = (found: Locator) =>
  found.evaluateAll((all) => all.map((one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim()))

/** How `figure` is underlined: its line, its style and its colour, as painted. */
const underlineOf = (figure: Locator) =>
  figure.evaluate((element) => {
    const painted = getComputedStyle(element)
    return {
      line: painted.textDecorationLine,
      style: painted.textDecorationStyle,
      colour: painted.textDecorationColor,
    }
  })

/** The colour `token` paints, as getComputedStyle writes it. */
async function paintOf(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const span = document.createElement('span')
    span.style.color = `var(${name})`
    document.body.append(span)
    const painted = getComputedStyle(span).color
    span.remove()
    return painted
  }, token)
}

/** `figure` underlined wavy, in the error's colour. */
async function expectWavy(page: Page, figure: Locator) {
  const error = await paintOf(page, '--color-error')
  await expect
    .poll(() => underlineOf(figure))
    .toEqual({ line: 'underline', style: 'wavy', colour: error })
}

/** `figure` with no line under it. */
async function expectNoLine(figure: Locator) {
  await expect.poll(async () => (await underlineOf(figure)).line).toBe('none')
}

/** `figure` underlined dashed, in the muted colour: an estimate. */
async function expectDashed(page: Page, figure: Locator) {
  const muted = await paintOf(page, '--color-muted')
  await expect
    .poll(() => underlineOf(figure))
    .toEqual({ line: 'underline', style: 'dashed', colour: muted })
}

/** A yen spend today, in Reports wide enough for the week before; `env` reaches the app. */
async function aYenWeek(env: Record<string, string> = {}): Promise<Page> {
  const { page } = await launch(aHome(), env)
  await yenFromCash(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await goTo(page, 'Reports')
  return page
}

/** Yen seven days back and today, the wallet added once; `env` reaches the app. */
async function aYenWeekAndTheOneBefore(env: Record<string, string> = {}): Promise<Page> {
  const { page } = await launch(aHome(), env)
  await yenFromCash(page, daysAgo(7))
  // The line keeps the day it was last given, so today's is typed in full.
  await yenFromCash(page, today(), false)
  await page.setViewportSize({ width: 1440, height: 900 })
  await goTo(page, 'Reports')
  return page
}

/**
 * Yen seven days back and today, `rate` typed for the one seven back: today's borrows it.
 * `euros` are the days a 10 EUR spend from purse is written on, before Reports opens; `env`
 * reaches the app.
 */
async function aBorrowedWeek(
  rate = '0.0091',
  euros: string[] = [],
  env: Record<string, string> = {},
): Promise<Page> {
  const { page } = await launch(aHome(), env)
  await yenFromCash(page, daysAgo(7))
  await yenFromCash(page, today(), false)
  for (const [at, day] of euros.entries()) {
    await fromWallet(page, 'purse', 'EUR', '10', day, at === 0)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await goTo(page, 'Reports')
  const lastWeek = await openFigure(page, 'before')
  await writeRate(lastWeek, rate, 'JPY')
  await expect.poll(() => lastWeek.count()).toBe(0)
  return page
}

/** frankfurter.dev's stand-in: `rate` CAD for one of any currency each day asked, or `status`. */
async function aRateService(rate = '0.0091', status = 200) {
  let asked = 0
  const server = createServer((request, response) => {
    asked += 1
    const at = new URL(request.url ?? '', 'http://127.0.0.1')
    if (status !== 200) {
      // A failed request answers after a moment, as a network's failure does: the app's wait shows.
      setTimeout(() => {
        if (response.destroyed) return
        response.writeHead(status)
        response.end()
      }, 150)
      return
    }
    const base = at.searchParams.get('base') ?? ''
    const quotes = at.searchParams.get('quotes') ?? ''
    const from = at.searchParams.get('from') ?? ''
    const to = at.searchParams.get('to') ?? ''
    const rates = []
    for (let day = from; day <= to; day = addDays(day, 1)) {
      rates.push(`{"date":"${day}","base":"${base}","quote":"${quotes}","rate":${rate}}`)
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(`[${rates.join(',')}]`)
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  const { port } = server.address() as AddressInfo
  return { env: { HAVE_FISH_RATES_URL: `http://127.0.0.1:${port}/v2/rates` }, asked: () => asked }
}

describe('a yen spend my CAD card paid', () => {
  test('4000 jpy from visa: the line asks what it was charged, in CAD, and Tab goes there', async () => {
    const page = await withVisa()

    await fromVisa(page, '4000 jpy')

    await expect.poll(() => page.locator(CHARGED).isVisible()).toBe(true)
    await expect
      .poll(() => page.locator(CHARGED).evaluate((input) => input.nextSibling?.textContent))
      .toBe('CAD')
    await page.keyboard.press('Tab')
    await expect.poll(() => focusedName(page)).toBe('charged')
  })

  test('4000 with no code from visa: no charge is asked, and Tab goes to the description', async () => {
    const page = await withVisa()

    await fromVisa(page, '4000')
    await page.keyboard.press('Tab')

    await expect.poll(() => focusedName(page)).toBe('description')
    expect(await page.locator(CHARGED).count()).toBe(0)
  })

  test('saved with its charge, the row reads 4,000 JPY', async () => {
    const page = await withVisa()

    await writeDinner(page)

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,000 JPY`])
  })

  test('its card says the dollars it was charged, and the rate', async () => {
    const page = await aDinner()

    await openSelected(page)

    await expect
      .poll(() => convertedLine(page))
      .toBe('with 36.20 CAD converted at 1 CAD = 110.5 JPY')
  })

  test('visa owes the 36.20 it was charged', async () => {
    const page = await aDinner()

    await goTo(page, 'Accounts')

    await expect.poll(() => accountLines(page)).toEqual(['visa | owed 36.20 CAD'])
  })

  test('a charge typed, then the code taken off the amount: the part goes, and it is not sent', async () => {
    const page = await withVisa()
    await fromVisa(page, '4000 jpy')
    await page.keyboard.press('Tab')
    await page.keyboard.type('36.20')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Dinner')

    await page.fill(AMOUNT, '4000')
    await expect.poll(() => page.locator(CHARGED).count()).toBe(0)
    await page.press(AMOUNT, 'Enter')
    await page.keyboard.press('Escape')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,000.00`])
    await openSelected(page)
    await expect.poll(() => page.locator(chip('amount')).innerText()).toBe('4,000.00 CAD')
    expect(await page.locator(CONVERTED).count()).toBe(0)
  })

  test('to an account of mine, no charge is asked, and the yen are refused as locked', async () => {
    const page = await withVisa()
    await addAccount(page, 'cash', 'cash')
    await fromVisa(page, '4000 jpy')
    await expect.poll(() => page.locator(CHARGED).isVisible()).toBe(true)

    await pickPath(page, `${WRITE} input[name=to]`, 'cash')
    await expect.poll(() => page.locator(CHARGED).count()).toBe(0)
    await page.press(AMOUNT, 'Enter')

    await expect
      .poll(() => page.locator(`${WRITE} [role=alert]`).innerText())
      .toBe('currency locked')
    expect(await rows(page)).toEqual([])
  })

  test('with From left empty, the line asks as for visa, the account it assumes', async () => {
    const page = await aDinner()
    await openComposer(page)
    await page.fill(`${WRITE} input[name=from]`, '')
    await page.locator(AMOUNT).focus()
    await expect.poll(() => page.inputValue(`${WRITE} input[name=from]`)).toBe('')

    await page.keyboard.type('4000 jpy')

    await expect.poll(() => page.locator(CHARGED).isVisible()).toBe(true)
    await expect
      .poll(() => page.locator(CHARGED).evaluate((input) => input.nextSibling?.textContent))
      .toBe('CAD')
  })

  test('the next line asks for its own charge: the last one saved is not carried', async () => {
    const page = await aDinner()

    await fromVisa(page, '4000 jpy')

    await expect.poll(() => page.locator(CHARGED).isVisible()).toBe(true)
    expect(await page.inputValue(CHARGED)).toBe('')
  })
})

describe('a yen spend my CAD card paid, before the bank says', () => {
  test('8400 jpy from visa: the charged part says the charge awaits the statement', async () => {
    const page = await withVisa()

    await fromVisa(page, '8400 jpy')

    await expect.poll(() => page.getAttribute(CHARGED, 'placeholder')).toBe('awaiting statement')
  })

  test('its charge left empty, Enter: the row reads 8,400 JPY', async () => {
    const page = await aWaitingLunch()

    expect(await rows(page)).toEqual([`${shownDay(today())} | Lunch | 8,400 JPY`])
  })

  test('on Accounts, visa ends with 8,400 JPY awaiting the statement, its balance as it was', async () => {
    const page = await aWaitingLunch()

    await goTo(page, 'Accounts')

    await expect
      .poll(async () => (await accountLines(page))[0] ?? '')
      .toMatch(/^visa \| (Card \| )?0\.00 CAD · −8,400 JPY awaiting statement$/)
  })

  test('its card says the charge awaits the statement, with no rate', async () => {
    const page = await aWaitingLunch()

    await openSelected(page)

    await expect.poll(() => convertedLine(page)).toBe('with awaiting statement')
    expect(await page.locator(`${PANE} [aria-label="Rate"]`).count()).toBe(0)
  })

  test('the charged chip, 76.30 and Enter: visa owes 76.30, and nothing waits', async () => {
    const page = await aWaitingLunch()
    await openSelected(page)
    await openChip(page, 'charged')
    await page.fill(CHARGED_FIELD, '76.30')
    await page.press(CHARGED_FIELD, 'Enter')
    await expect.poll(() => page.locator(CHARGED_FIELD).count()).toBe(0)

    await goTo(page, 'Accounts')

    await expect.poll(() => accountLines(page)).toEqual(['visa | owed 76.30 CAD'])
  })

  test('after 76.30, the card reads the card’s 76.30 CAD and its rate', async () => {
    const page = await aWaitingLunch()
    await openSelected(page)
    await openChip(page, 'charged')
    await page.fill(CHARGED_FIELD, '76.30')
    await page.press(CHARGED_FIELD, 'Enter')

    await expect.poll(() => convertedLine(page)).toContain('76.30 CAD')
    expect(await convertedLine(page)).toContain('converted at 1 CAD = 110.1 JPY')
  })

  test('after 76.30, Ctrl+Z on the list: the chip says the charge awaits again', async () => {
    const page = await aWaitingLunch()
    await openSelected(page)
    await openChip(page, 'charged')
    await page.fill(CHARGED_FIELD, '76.30')
    await page.press(CHARGED_FIELD, 'Enter')
    await expect.poll(() => page.locator(CHARGED_FIELD).count()).toBe(0)

    await page.locator('ol[aria-label=Ledger]').focus()
    await page.keyboard.press('Control+z')

    await expect.poll(() => convertedLine(page)).toContain('with awaiting statement')
  })

  test('the charged chip, abc and Enter: the chip says not an amount', async () => {
    const page = await aWaitingLunch()
    await openSelected(page)
    await openChip(page, 'charged')
    await page.fill(CHARGED_FIELD, 'abc')
    await page.press(CHARGED_FIELD, 'Enter')

    await expect
      .poll(() => page.locator(`${PANE} [role=alert]`).innerText())
      .toBe(copy.errors.codes.CHARGED_INVALID)
  })
})

describe('fixing the amounts of a converted spend', () => {
  /** The dinner's card open, `part`'s chip opened, `typed` in its field, and Enter. */
  async function change(page: Page, part: string, typed: string) {
    await openSelected(page)
    await openChip(page, part)
    await page.fill(`${PANE} input[name=${part}]`, typed)
    await page.press(`${PANE} input[name=${part}]`, 'Enter')
  }

  test('the amount chip, 4500 jpy and Enter: the row reads 4,500 JPY', async () => {
    const page = await aDinner()

    await change(page, 'amount', '4500 jpy')

    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,500 JPY`])
  })

  test('after 4500 jpy, the card still says the 36.20 charged, at its new rate', async () => {
    const page = await aDinner()

    await change(page, 'amount', '4500 jpy')

    await expect
      .poll(() => convertedLine(page))
      .toBe('with 36.20 CAD converted at 1 CAD = 124.3 JPY')
  })

  test('after 4500 jpy, visa still owes the 36.20', async () => {
    const page = await aDinner()
    await change(page, 'amount', '4500 jpy')
    await expect.poll(() => rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,500 JPY`])

    await goTo(page, 'Accounts')

    await expect.poll(() => accountLines(page)).toEqual(['visa | owed 36.20 CAD'])
  })

  test('the charged chip opens holding 36.20', async () => {
    const page = await aDinner()
    await openSelected(page)

    await openChip(page, 'charged')

    await expect.poll(() => page.inputValue(CHARGED_FIELD)).toBe('36.20')
  })

  test('the charged chip opens with CAD after its field', async () => {
    const page = await aDinner()
    await openSelected(page)

    await openChip(page, 'charged')

    await expect
      .poll(() => page.locator(CHARGED_FIELD).evaluate((input) => input.nextSibling?.textContent))
      .toBe('CAD')
  })

  test('the charged chip, 38.10 and Enter: visa owes 38.10', async () => {
    const page = await aDinner()
    await change(page, 'charged', '38.10')
    await expect.poll(() => page.locator(CHARGED_FIELD).count()).toBe(0)

    await goTo(page, 'Accounts')

    await expect.poll(() => accountLines(page)).toEqual(['visa | owed 38.10 CAD'])
  })

  test('after 38.10, the row still reads 4,000 JPY', async () => {
    const page = await aDinner()

    await change(page, 'charged', '38.10')

    await expect.poll(() => convertedLine(page)).toContain('38.10 CAD')
    expect(await rows(page)).toEqual([`${shownDay(today())} | Dinner | 4,000 JPY`])
  })

  test('the amount chip, 40 and Enter: the card has no converted line', async () => {
    const page = await aDinner()
    await openSelected(page)
    expect(await page.locator(CONVERTED).count()).toBe(1)

    await openChip(page, 'amount')
    await page.fill(`${PANE} input[name=amount]`, '40')
    await page.press(`${PANE} input[name=amount]`, 'Enter')

    await expect.poll(() => page.locator(CONVERTED).count()).toBe(0)
  })

  test('after 40, visa owes 40.00', async () => {
    const page = await aDinner()
    await change(page, 'amount', '40')
    await expect.poll(() => page.locator(CONVERTED).count()).toBe(0)

    await goTo(page, 'Accounts')

    await expect.poll(() => accountLines(page)).toEqual(['visa | owed 40.00 CAD'])
  })

  test('the amount chip, 30 eur and Enter: converted from the same 36.20, at a euro rate', async () => {
    const page = await aDinner()

    await change(page, 'amount', '30 eur')

    await expect
      .poll(() => convertedLine(page))
      .toBe('with 36.20 CAD converted at 1 CAD = 0.8287 EUR')
  })

  test('after 40, Ctrl+Z on the list: the card converts the 36.20 again', async () => {
    const page = await aDinner()
    await change(page, 'amount', '40')
    await expect.poll(() => page.locator(CONVERTED).count()).toBe(0)

    await page.locator('ol[aria-label=Ledger]').focus()
    await page.keyboard.press('Control+z')

    await expect
      .poll(() => convertedLine(page))
      .toBe('with 36.20 CAD converted at 1 CAD = 110.5 JPY')
  })

  test('the charged chip, abc and Enter: the chip says why', async () => {
    const page = await aDinner()

    await change(page, 'charged', 'abc')

    await expect
      .poll(() => page.locator(`${PANE} [role=alert]`).innerText())
      .toBe(copy.errors.codes.CHARGED_INVALID)
  })

  test('the charged chip cleared, and Enter: the chip says why', async () => {
    const page = await aDinner()

    await change(page, 'charged', '')

    await expect
      .poll(() => page.locator(`${PANE} [role=alert]`).innerText())
      .toBe(copy.errors.codes.CHARGED_INVALID)
  })

  test('its card’s Rate chip is locked', async () => {
    const page = await aDinner()

    await openSelected(page)

    await expect.poll(() => page.locator(`${PANE} [aria-label="Rate"]`).isDisabled()).toBe(true)
  })
})

describe('a converted spend in Reports', () => {
  /** The dinner in Reports, wide enough for Last week, with ¥1,500 from cash on `yenOn` if set. */
  async function aDinnerInReports(yenOn?: string): Promise<Page> {
    const page = await aDinner()
    if (yenOn !== undefined) await yenFromCash(page, yenOn)
    await page.setViewportSize({ width: 1440, height: 900 })
    await goTo(page, 'Reports')
    return page
  }

  test('the dinner: Unsorted counts the 36.20 it cost', async () => {
    const page = await aDinnerInReports()

    await expect.poll(() => reportTree(page)).toEqual(['Unsorted | 36.20 | – | 36.20 more'])
  })

  test('beside 1500 yen in cash, no rate: the Unsorted 36.20 is underlined, and so is the total’s', async () => {
    const page = await aDinner()
    await yenFromCash(page)

    await goTo(page, 'Reports')

    const unsorted = treeRow(page, 'Unsorted')
    await expect
      .poll(() => textsOf(unsorted.locator('[data-cell=shown]')))
      .toEqual(['36.20 + 1,500 JPY'])
    await expect.poll(() => unsorted.locator('[data-cell=shown] [data-guessed]').count()).toBe(1)
    const foot = page.locator("p:has-text('All spending')")
    await expect
      .poll(() => textsOf(foot.locator('[data-guessed]')))
      .toEqual(['36.20 + 1,500 JPY', '36.20 more'])
  })

  test('a guessed figure’s line is wavy, in the error’s colour', async () => {
    const page = await aYenWeek()

    await expectWavy(page, treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-look]'))
  })

  test('the total’s guessed figure is wavy too', async () => {
    const page = await aYenWeek()

    const foot = page.locator("p:has-text('All spending')")
    await expectWavy(page, foot.locator('[data-look]').first())
  })

  test('a guess last week: the change is wavy', async () => {
    const page = await aDinnerInReports(daysAgo(7))

    await expectWavy(page, treeRow(page, 'Unsorted').locator('[data-cell=change] [data-look]'))
  })

  test('a guess last week: This week has no line', async () => {
    const page = await aDinnerInReports(daysAgo(7))

    await expectNoLine(treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-look]'))
  })

  test('the dinner alone: its figure has no line', async () => {
    const page = await aDinnerInReports()

    await expectNoLine(treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-look]'))
  })

  test('a guess last week: its Last week cell and the change are underlined, its This week is not', async () => {
    const page = await aDinnerInReports(daysAgo(7))

    const unsorted = treeRow(page, 'Unsorted')
    await expect.poll(() => unsorted.locator('[data-cell=before] [data-guessed]').count()).toBe(1)
    await expect.poll(() => unsorted.locator('[data-cell=shown] [data-guessed]').count()).toBe(0)
    await expect.poll(() => unsorted.locator('[data-cell=change] [data-guessed]').count()).toBe(1)
    const foot = page.locator("p:has-text('All spending')")
    await expect
      .poll(() => textsOf(foot.locator('[data-guessed]')))
      .toEqual(['1,500 JPY', '36.20 more'])
  })

  test('a guess this week with nothing last week: the change reads same, and is underlined too', async () => {
    const { page } = await launch(aHome())
    await yenFromCash(page)
    // Wide enough for the week before's column.
    await page.setViewportSize({ width: 1440, height: 900 })

    await goTo(page, 'Reports')

    const foot = page.locator("p:has-text('All spending')")
    await expect
      .poll(() => textsOf(foot.locator('[data-guessed]')))
      .toEqual(['1,500 JPY', copy.reports.tree.change.same])
  })

  test('the dinner alone: no cell of the tree is underlined', async () => {
    const page = await aDinnerInReports()

    await expect.poll(() => reportTree(page)).toEqual(['Unsorted | 36.20 | – | 36.20 more'])
    await expect.poll(() => page.locator('[data-guessed]').count()).toBe(0)
  })

  test('the dinner and the yen from cash: no line reads “Not in these totals”', async () => {
    const page = await aDinnerInReports(today())

    await expect
      .poll(() => reportTree(page))
      .toEqual(['Unsorted | 36.20 + 1,500 JPY | – | 36.20 more'])
    await expect.poll(() => page.getByText('Not in these totals').count()).toBe(0)
  })

  test('only the yen: its figure reads 1,500 JPY, with no 0.00', async () => {
    const page = await aYenWeek()

    const unsorted = treeRow(page, 'Unsorted')
    await expect.poll(() => textsOf(unsorted.locator('[data-cell=shown]'))).toEqual(['1,500 JPY'])
    await expect.poll(() => unsorted.locator('[data-uncounted]').count()).toBe(1)
  })

  test('a rate typed for the yen: the figure reads 49.85, with nothing under it', async () => {
    const page = await aDinnerInReports(today())
    const popover = await openFigure(page, 'shown')

    await writeRate(popover, '0.0091')

    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(0)
    await expect.poll(() => reportTree(page)).toEqual(['Unsorted | 49.85 | – | 49.85 more'])
    await expect.poll(() => page.locator('[data-uncounted]').count()).toBe(0)
  })

  test('the header’s line says the yen it couldn’t count', async () => {
    const page = await aDinnerInReports(today())

    await expect
      .poll(() => reportSums(page))
      .toBe('Spent 36.20 + 1,500 JPY, against 0.00 last week')
  })

  test('the header’s line says the yen last week couldn’t count', async () => {
    const page = await aDinnerInReports(daysAgo(7))

    await expect.poll(() => reportSums(page)).toBe('Spent 36.20, against 1,500 JPY last week')
  })

  test('a guess last week: the row’s Last week reads 1,500 JPY', async () => {
    const page = await aDinnerInReports(daysAgo(7))

    await expect
      .poll(() => textsOf(treeRow(page, 'Unsorted').locator('[data-cell=before]')))
      .toEqual(['1,500 JPY'])
  })

  test('what a figure couldn’t count sits on its own line, small and muted', async () => {
    const page = await aDinnerInReports(today())

    const cell = treeRow(page, 'Unsorted').locator('[data-cell=shown]')
    const line = cell.locator('[data-uncounted]')
    await expect.poll(() => line.count()).toBe(1)

    const painted = await line.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        display: style.display,
        size: Number.parseFloat(style.fontSize),
        colour: style.color,
      }
    })
    const cellSize = await cell.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    )
    expect(painted.display).toBe('block')
    expect(painted.size).toBeLessThan(cellSize)
    expect(painted.colour).toBe(await paintOf(page, '--color-muted'))
  })

  test('the Unsorted row picked: the list beside reads Dinner at 4,000 JPY', async () => {
    const page = await aDinner()
    await goTo(page, 'Reports')

    await treeRow(page, 'Unsorted').click()

    await expect
      .poll(() =>
        spendCells(page.locator(`${BEHIND} li`)).then((all) =>
          all.map(([, description, amount]) => [description, amount]),
        ),
      )
      .toEqual([['Dinner', '4,000 JPY']])
  })
})

describe('fixing a guessed rate in Reports', () => {
  /** `read`'s figure, opened once `write`'s took 0.0091 and `cleared` stopped guessing. */
  async function figureOnceWritten(
    page: Page,
    write: string,
    cleared: string,
    read: string,
  ): Promise<Locator> {
    const popover = await openFigure(page, write)
    await writeRate(popover, '0.0091')
    await expect
      .poll(() =>
        treeRow(page, 'Unsorted').locator(`[data-cell=${cleared}] [data-guessed]`).count(),
      )
      .toBe(0)
    return openFigure(page, read)
  }

  test('a guessed week figure opens its days, in a dialog named for them', async () => {
    const page = await aYenWeek()

    const popover = await openFigure(page, 'shown')

    await expect.poll(() => popover.getByRole('textbox').count()).toBe(1)
    await expect
      .poll(() =>
        popover
          .getByRole('textbox', { name: copy.reports.guesses.missing('JPY'), exact: true })
          .count(),
      )
      .toBe(1)
  })

  test('the cursor is in its first field', async () => {
    const page = await aYenWeek()
    await openFigure(page, 'shown')

    await expect.poll(() => focusedIn(page)).toBe(`${copy.reports.guesses.label} INPUT`)
  })

  test('the change asks once for both weeks’ yen', async () => {
    const page = await aYenWeekAndTheOneBefore()

    const popover = await openFigure(page, 'change')

    await expect.poll(() => labelsOf(popover)).toEqual([copy.reports.guesses.missing('JPY')])
  })

  test('the change writes its yen rate for last week’s day', async () => {
    const page = await aYenWeekAndTheOneBefore()

    const popover = await figureOnceWritten(page, 'change', 'before', 'shown')

    await expect
      .poll(() => labelsOf(popover))
      .toEqual([`${shownDay(today())} · JPY · using 0.0091 from ${shownDay(daysAgo(7))}`])
  })

  test('this week’s figure writes today, and last week borrows it', async () => {
    const page = await aYenWeekAndTheOneBefore()

    const popover = await figureOnceWritten(page, 'shown', 'shown', 'before')

    await expect
      .poll(() => labelsOf(popover))
      .toEqual([`${shownDay(daysAgo(7))} · JPY · using 0.0091 from ${shownDay(today())}`])
  })

  test('Enter writes the rate, and the figure stops being a guess', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')

    await writeRate(popover, '0.0091')

    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(0)
  })

  test('a rate I typed: the figure has no line', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')

    await writeRate(popover, '0.0091')

    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(0)
    await expectNoLine(treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-look]'))
  })

  test('Enter closes the popover, and the tree takes the cursor', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')

    await writeRate(popover, '0.0091')

    await expect.poll(() => popover.count()).toBe(0)
    await expect.poll(() => focusedLabel(page)).toBe(copy.reports.tree.label)
  })

  test('a rate written for last week is borrowed by this week', async () => {
    const page = await aYenWeekAndTheOneBefore()

    const popover = await figureOnceWritten(page, 'before', 'before', 'shown')

    await expect
      .poll(() => labelsOf(popover))
      .toEqual([`${shownDay(today())} · JPY · using 0.0091 from ${shownDay(daysAgo(7))}`])
  })

  test('Ctrl+Z takes the rate out, and the figure is a guess again', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')
    await writeRate(popover, '0.0091')
    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(0)

    await page.keyboard.press('Control+z')

    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(1)
  })

  test('a rate that isn’t one is refused under its field', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')

    await writeRate(popover, '1.7x')

    await expect
      .poll(() => popover.getByRole('alert').innerText())
      .toBe(copy.errors.codes.RATE_INVALID)
  })

  test('a refused rate keeps the popover and what was typed', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')

    await writeRate(popover, '1.7x')

    await expect.poll(() => popover.count()).toBe(1)
    await expect.poll(() => popover.getByRole('textbox').inputValue()).toBe('1.7x')
  })

  test('Escape after a refusal leaves the figure a guess', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')
    await writeRate(popover, '1.7x')

    await page.keyboard.press('Escape')

    await expect.poll(() => popover.count()).toBe(0)
    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(1)
  })

  test('Escape closes it with nothing written', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')
    await popover.getByRole('textbox').fill('0.0091')

    await page.keyboard.press('Escape')

    await expect.poll(() => popover.count()).toBe(0)
    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(1)
  })

  test('a click away closes it', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')

    await page.getByText(copy.reports.tree.total, { exact: true }).click()

    await expect.poll(() => popover.count()).toBe(0)
  })

  test('a click away saves nothing', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')
    await popover.getByRole('textbox').fill('0.0091')

    await page.getByText(copy.reports.tree.total, { exact: true }).click()

    await expect.poll(() => popover.count()).toBe(0)
    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(1)
  })

  test('a click on nothing gives the tree the cursor', async () => {
    const page = await aYenWeek()
    await openFigure(page, 'shown')

    await page.getByText(copy.reports.tree.total, { exact: true }).click()

    await expect.poll(() => focusedLabel(page)).toBe(copy.reports.tree.label)
  })

  test('a click on another control keeps the cursor there', async () => {
    const page = await aYenWeek()
    const popover = await openFigure(page, 'shown')

    await page.getByRole('button', { name: copy.reports.week.before }).click()

    await expect.poll(() => popover.count()).toBe(0)
    await expect.poll(() => focusedLabel(page)).toBe(copy.reports.week.before)
  })

  test('the total’s figure lists every guessed day', async () => {
    const page = await aYenWeek()

    const foot = page.locator("p:has-text('All spending')")
    await foot.locator('[data-guessed]').first().click()

    const popover = guesses(page)
    await expect.poll(() => popover.getByRole('textbox').count()).toBe(1)
    await expect
      .poll(() =>
        popover
          .getByRole('textbox', { name: copy.reports.guesses.missing('JPY'), exact: true })
          .count(),
      )
      .toBe(1)
  })

  test('a click on a guessed figure leaves the row unpicked', async () => {
    const page = await aYenWeek()
    const row = treeRow(page, 'Unsorted')
    await expect.poll(() => row.getAttribute('aria-selected')).toBe('false')

    await row.locator('[data-cell=shown] [data-guessed]').click()

    await expect.poll(() => row.getAttribute('aria-selected')).toBe('false')
  })
})

describe('using the nearest rates in Reports', () => {
  /** The button that writes every borrowed line at the figures the popover showed. */
  const nearestButton = (popover: Locator) =>
    popover.getByRole('button', { name: copy.reports.guesses.nearest })

  /** What the Unsorted row's shown cell reads. */
  const shownText = (page: Page) =>
    treeRow(page, 'Unsorted').locator('[data-cell=shown]').innerText()

  test('a borrowed week shows the button under its fields', async () => {
    const page = await aBorrowedWeek()

    const popover = await openFigure(page, 'shown')

    await expect.poll(() => nearestButton(popover).count()).toBe(1)
  })

  test('a week with no rate anywhere has no button', async () => {
    const page = await aYenWeek()

    const popover = await openFigure(page, 'shown')

    await expect.poll(() => popover.getByRole('textbox').count()).toBe(1)
    expect(await nearestButton(popover).count()).toBe(0)
  })

  test('the button writes today’s rate, and the figure stops being a guess', async () => {
    const page = await aBorrowedWeek()
    const popover = await openFigure(page, 'shown')

    await nearestButton(popover).click()

    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(0)
  })

  test('the button closes the popover', async () => {
    const page = await aBorrowedWeek()
    const popover = await openFigure(page, 'shown')

    await nearestButton(popover).click()

    await expect.poll(() => popover.count()).toBe(0)
  })

  test('the tree takes the cursor once the button closes it', async () => {
    const page = await aBorrowedWeek()
    const popover = await openFigure(page, 'shown')

    await nearestButton(popover).click()

    await expect.poll(() => focusedLabel(page)).toBe(copy.reports.tree.label)
  })

  test('the button writes the figures the label showed, not the borrowed day’s whole rate', async () => {
    const page = await aBorrowedWeek('0.0091234')
    const popover = await openFigure(page, 'shown')
    await expect
      .poll(() => popover.getByRole('textbox', { name: /using 0\.009123 from/ }).count())
      .toBe(1)

    await nearestButton(popover).click()

    await expect.poll(() => shownText(page)).toContain('13.68')
  })

  test('a rate typed in a field but not entered is not what the button writes', async () => {
    const page = await aBorrowedWeek()
    const popover = await openFigure(page, 'shown')
    await popover.getByRole('textbox').fill('1.80')

    await nearestButton(popover).click()
    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(0)

    await expect.poll(() => shownText(page)).toContain('13.65')
  })

  test('a line with no rate is left as it was', async () => {
    const page = await aBorrowedWeek('0.0091', [today()])
    const popover = await openFigure(page, 'shown')

    await expect
      .poll(() => labelsOf(popover))
      .toEqual([
        copy.reports.guesses.missing('EUR'),
        `${shownDay(today())} · JPY · using 0.0091 from ${shownDay(daysAgo(7))}`,
      ])

    await nearestButton(popover).click()
    await expect.poll(() => popover.count()).toBe(0)

    // The EUR line keeps the cell underlined, so no count says the write landed: read the
    // popover opened after the reload, and close it again inside the poll.
    await expect
      .poll(async () => {
        const again = await openFigure(page, 'shown')
        const labels = await labelsOf(again)
        await page.keyboard.press('Escape')
        return labels
      })
      .toEqual([copy.reports.guesses.missing('EUR')])
  })

  test('one undo takes every rate the button wrote', async () => {
    const page = await aBorrowedWeek('0.0091', [daysAgo(7), today()])
    const lastWeek = await openFigure(page, 'before')
    await writeRate(lastWeek, '1.5', 'EUR')
    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=before] [data-guessed]').count())
      .toBe(0)

    const popover = await openFigure(page, 'shown')
    await nearestButton(popover).click()
    await expect.poll(() => popover.count()).toBe(0)
    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-guessed]').count())
      .toBe(0)

    await page.keyboard.press('Control+z')

    const again = await openFigure(page, 'shown')
    await expect
      .poll(() => labelsOf(again))
      .toEqual([expect.stringContaining('using'), expect.stringContaining('using')])
  })
})

// A packaged build always asks frankfurter.dev, whatever HAVE_FISH_RATES_URL says.
describe.skipIf(process.env.E2E_APP)('fetching the rates a figure guessed', () => {
  /** The Fetch rates summary, which opens what fetching sends. */
  const fetchSummary = (popover: Locator) =>
    popover.locator('summary', { hasText: copy.reports.fetch.open })

  /** Allow this once. */
  const allowButton = (popover: Locator) =>
    popover.getByRole('button', { name: copy.reports.fetch.once })

  /** Fetch rates, then Allow this once. */
  async function allowOnce(popover: Locator) {
    await fetchSummary(popover).click()
    await allowButton(popover).click()
  }

  /** The Unsorted row's guessed figures in `cell`, each a button of its own. */
  const guessedIn = (page: Page, cell: string) =>
    treeRow(page, 'Unsorted').locator(`[data-cell=${cell}] [data-guessed]`)

  test('a guessed figure offers Fetch rates', async () => {
    const page = await aYenWeek()

    const popover = await openFigure(page, 'shown')

    await expect.poll(() => fetchSummary(popover).count()).toBe(1)
  })

  test('a figure that borrows a rate offers them too', async () => {
    const page = await aBorrowedWeek()

    const popover = await openFigure(page, 'shown')

    await expect.poll(() => fetchSummary(popover).count()).toBe(1)
  })

  test('what fetching sends is folded until Fetch is clicked', async () => {
    const page = await aYenWeek()

    const popover = await openFigure(page, 'shown')

    await expect.poll(() => allowButton(popover).count()).toBe(0)
  })

  test('Fetch says what is sent, and to whom', async () => {
    const page = await aYenWeek()

    const popover = await openFigure(page, 'shown')
    await fetchSummary(popover).click()

    await expect.poll(() => popover.getByText(copy.reports.fetch.sends).count()).toBe(1)
  })

  test('opened, it offers Allow this once', async () => {
    const page = await aYenWeek()

    const popover = await openFigure(page, 'shown')
    await fetchSummary(popover).click()

    await expect.poll(() => allowButton(popover).count()).toBe(1)
  })

  test('nothing is sent until I allow it, and then one request is', async () => {
    const service = await aRateService()
    const page = await aYenWeek(service.env)
    const popover = await openFigure(page, 'shown')
    await fetchSummary(popover).click()
    await expect.poll(() => popover.getByText(copy.reports.fetch.sends).count()).toBe(1)
    expect(service.asked()).toBe(0)

    await allowButton(popover).click()

    await expect.poll(() => guessedIn(page, 'shown').count()).toBe(0)
    expect(service.asked()).toBe(1)
  })

  test('Allow writes the day, and the figure stops guessing', async () => {
    const service = await aRateService()
    const page = await aYenWeek(service.env)

    await allowOnce(await openFigure(page, 'shown'))

    await expect.poll(() => guessedIn(page, 'shown').count()).toBe(0)
  })

  test('the rate it fetched marks the figure an estimate', async () => {
    const service = await aRateService()
    const page = await aYenWeek(service.env)

    await allowOnce(await openFigure(page, 'shown'))
    await expect.poll(() => guessedIn(page, 'shown').count()).toBe(0)

    await expectDashed(page, treeRow(page, 'Unsorted').locator('[data-cell=shown] [data-look]'))
  })

  test('and the total that holds it', async () => {
    const service = await aRateService()
    const page = await aYenWeek(service.env)

    await allowOnce(await openFigure(page, 'shown'))
    await expect.poll(() => guessedIn(page, 'shown').count()).toBe(0)

    const foot = page.locator("p:has-text('All spending')")
    await expectDashed(page, foot.locator('[data-look]').first())
  })

  test('a borrowed figure is written too', async () => {
    const service = await aRateService()
    const page = await aBorrowedWeek('0.0091', [], service.env)

    await allowOnce(await openFigure(page, 'shown'))

    await expect.poll(() => guessedIn(page, 'shown').count()).toBe(0)
  })

  test('Allow closes the popover', async () => {
    const service = await aRateService()
    const page = await aYenWeek(service.env)
    const popover = await openFigure(page, 'shown')

    await allowOnce(popover)

    await expect.poll(() => popover.count()).toBe(0)
  })

  test('and the tree takes the cursor', async () => {
    const service = await aRateService()
    const page = await aYenWeek(service.env)

    await allowOnce(await openFigure(page, 'shown'))

    await expect.poll(() => focusedLabel(page)).toBe(copy.reports.tree.label)
  })

  test('a new popover asks again: once is once', async () => {
    const service = await aRateService()
    const page = await aYenWeekAndTheOneBefore(service.env)
    await allowOnce(await openFigure(page, 'shown'))
    await expect.poll(() => guessedIn(page, 'shown').count()).toBe(0)

    const lastWeek = await openFigure(page, 'before')
    await expect.poll(() => allowButton(lastWeek).count()).toBe(0)
    await fetchSummary(lastWeek).click()

    await expect.poll(() => lastWeek.getByText(copy.reports.fetch.sends).count()).toBe(1)
  })

  test('a rate typed but not entered is not what a fetch uses', async () => {
    const service = await aRateService('0.0091')
    const page = await aYenWeek(service.env)
    const popover = await openFigure(page, 'shown')
    await popover.getByRole('textbox').fill('1.80')

    await allowOnce(popover)

    await expect.poll(() => guessedIn(page, 'shown').count()).toBe(0)
    await expect
      .poll(() => treeRow(page, 'Unsorted').locator('[data-cell=shown]').innerText())
      .toContain('13.65')
  })

  test('Ctrl+Z takes the fetched rates back', async () => {
    const service = await aRateService()
    const page = await aYenWeek(service.env)
    await allowOnce(await openFigure(page, 'shown'))
    await expect.poll(() => guessedIn(page, 'shown').count()).toBe(0)

    await page.keyboard.press('Control+z')

    await expect.poll(() => guessedIn(page, 'shown').count()).toBe(1)
  })

  test('a service that fails says so under the first field', async () => {
    const service = await aRateService('0.0091', 500)
    const page = await aYenWeek(service.env)
    const popover = await openFigure(page, 'shown')

    await allowOnce(popover)

    await expect
      .poll(() => popover.getByRole('alert').innerText())
      .toBe(copy.errors.codes.RATES_NOT_FETCHED)
  })

  test('and the popover stays', async () => {
    const service = await aRateService('0.0091', 500)
    const page = await aYenWeek(service.env)
    const popover = await openFigure(page, 'shown')
    await allowOnce(popover)
    await expect
      .poll(() => popover.getByRole('alert').innerText())
      .toBe(copy.errors.codes.RATES_NOT_FETCHED)

    await expect.poll(() => popover.count()).toBe(1)
  })

  test('Escape closes it after a refusal, with Allow’s cursor back', async () => {
    const service = await aRateService('0.0091', 500)
    const page = await aYenWeek(service.env)
    const popover = await openFigure(page, 'shown')
    await allowOnce(popover)
    await expect
      .poll(() => popover.getByRole('alert').innerText())
      .toBe(copy.errors.codes.RATES_NOT_FETCHED)

    await expect.poll(() => focusedIn(page)).toBe(`${copy.reports.guesses.label} BUTTON`)
    await page.keyboard.press('Escape')

    await expect.poll(() => popover.count()).toBe(0)
  })
})
