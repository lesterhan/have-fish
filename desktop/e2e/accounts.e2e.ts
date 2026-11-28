// Adding a bank account or card, from the Accounts place: Entry-11's acceptance, with real keys.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { copy } from '../copy'
import {
  ACCOUNTS_TAB,
  ADD_ACCOUNT,
  aHome,
  BACK,
  CURRENCIES_TAB,
  focusedIn,
  focusedTab,
  launch,
  openChip,
  openSelected,
  PANE,
  rows,
  writeDown,
} from './app'

const NAV = 'nav[aria-label=Places]'
const LIST = 'ol[aria-label=Accounts]'
const ACCOUNT = 'section[aria-label="The account"]'
const ADDING = `${ACCOUNT} form[aria-label="Add an account"]`
const NAME = `${ADDING} input[name=name]`
const KIND = `${ADDING} select[name=kind]`
const CURRENCY = `${ADDING} select[name=currency]`
const TABLIST = 'role=tablist[name="Accounts"s]'
const ACCOUNTS_PANEL = 'role=tabpanel[name="Accounts"s]'
const CURRENCIES_PANEL = 'role=tabpanel[name="Currencies"s]'

/** The accounts list as text: name and balance (Kind goes at the size the window opens). */
const accounts = (page: Page) =>
  page
    .locator(`${LIST} li`)
    .evaluateAll((items) =>
      items.map((li) =>
        [...li.querySelectorAll('[data-cell]')].map((c) => c.textContent?.trim() ?? '').join(' | '),
      ),
    )
const selected = (page: Page) =>
  page.locator(`${LIST} li[aria-selected=true] [data-cell=name]`).allInnerTexts()
const current = (page: Page) => page.locator(`${NAV} [aria-current=page]`).innerText()
/** Add account, a name, a kind and maybe a currency, Enter: as a person does it. */
async function add(page: Page, name: string, kind: string, currency?: string) {
  await page.click(ADD_ACCOUNT)
  await page.locator(NAME).focus()
  await page.keyboard.type(name)
  await page.selectOption(KIND, kind)
  if (currency !== undefined) await page.selectOption(CURRENCY, currency)
  await page.locator(NAME).focus()
  await page.keyboard.press('Enter')
}

/** What a control's box is, so two boxes can be compared; a failure while it has none. */
async function boxOf(page: Page, target: string) {
  const box = await page.locator(target).boundingBox()
  if (box === null) throw new Error(`${target} has no box to measure`)
  return box
}

/** Currencies chosen, as a person clicks its tab; a failure while it isn't. */
async function chooseCurrencies(page: Page) {
  await page.click(CURRENCIES_TAB)
  await expect.poll(() => page.getAttribute(CURRENCIES_TAB, 'aria-selected')).toBe('true')
}

describe('the places', () => {
  test('Ledger, Accounts and Reports down the left; Ctrl+2 and Ctrl+1 go between them', async () => {
    const { page, press } = await launch(aHome())
    expect(await page.locator(`${NAV} button`).allInnerTexts()).toEqual([
      expect.stringMatching(/^Ledger\s+Ctrl\+1$/),
      expect.stringMatching(/^Accounts\s+Ctrl\+2$/),
      expect.stringMatching(/^Reports\s+Ctrl\+3$/),
      expect.stringMatching(/^Settings\s+Ctrl\+,$/),
    ])
    expect(await current(page)).toMatch(/^Ledger/)

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    expect(await page.isVisible(LIST)).toBe(true)
    expect(await page.isVisible('ol[aria-label=Ledger]')).toBe(false)

    press('ctrl+1')
    await expect.poll(() => current(page)).toMatch(/^Ledger/)
    // A fresh ledger: the line is open and every part is empty, so the cursor is in the first.
    await expect.poll(() => focusedIn(page)).toBe('Write down a spend from')
  })

  test('the wallet the first spend made is already there, as cash', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await page.click(`${NAV} button:has-text("Accounts")`)
    await expect.poll(() => accounts(page)).toEqual(['cash | −4.50 CAD'])
  })

  test('a change saved in the Ledger is what Accounts shows', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await openSelected(page)
    await openChip(page, 'amount')
    await page.fill(`${PANE} input[name=amount]`, '6')
    await page.press(`${PANE} input[name=amount]`, 'Enter')
    await expect.poll(async () => (await rows(page))[0]).toContain('6.00')

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    expect(await accounts(page)).toEqual(['cash | −6.00 CAD'])
    press('ctrl+1')
    await expect.poll(() => current(page)).toMatch(/^Ledger/)
    expect((await rows(page))[0]).toContain('6.00')
  })
})

describe('the tabs', () => {
  test('Ctrl+2 on a fresh ledger: the tablist named Accounts holds the tabs Accounts and Currencies, in that order, and Accounts is selected', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)

    await expect
      .poll(() => page.locator(TABLIST).getByRole('tab').allInnerTexts())
      .toEqual(['Accounts', 'Currencies'])
    await expect.poll(() => page.getAttribute(ACCOUNTS_TAB, 'aria-selected')).toBe('true')
  })

  test('Ctrl+2: the heading named Accounts is at most 1px wide and 1px tall, so it is heard and not shown', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)

    const heading = 'role=heading[name="Accounts"s]'
    await expect.poll(() => page.locator(heading).count()).toBe(1)
    const box = await boxOf(page, heading)
    expect(box.width).toBeLessThanOrEqual(1)
    expect(box.height).toBeLessThanOrEqual(1)
  })

  test("Ctrl+2: Add account is inside the tabpanel named Accounts, and its box ends above the list's", async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)

    const add = `${ACCOUNTS_PANEL} >> ${ADD_ACCOUNT}`
    await expect.poll(() => page.locator(add).count()).toBe(1)
    const button = await boxOf(page, add)
    const list = await boxOf(page, LIST)
    expect(button.y + button.height).toBeLessThanOrEqual(list.y)
  })

  test('Ctrl+2, a click on the Accounts tab, then ArrowRight: Currencies is selected, its panel says under construction, and the list is hidden', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)

    await page.click(ACCOUNTS_TAB)
    await page.keyboard.press('ArrowRight')

    await expect.poll(() => page.getAttribute(CURRENCIES_TAB, 'aria-selected')).toBe('true')
    await expect
      .poll(() => page.locator(CURRENCIES_PANEL).innerText())
      .toBe(copy.app.underConstruction)
    await expect.poll(() => page.isVisible(LIST)).toBe(false)
  })

  test('from there, ArrowLeft: Accounts is selected and the list is visible again', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    await chooseCurrencies(page)

    await page.keyboard.press('ArrowLeft')

    await expect.poll(() => page.getAttribute(ACCOUNTS_TAB, 'aria-selected')).toBe('true')
    await expect.poll(() => page.isVisible(LIST)).toBe(true)
  })

  test('Currencies chosen, then Ctrl+1, then Ctrl+2: Currencies is still selected', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    await chooseCurrencies(page)

    press('ctrl+1')
    await expect.poll(() => current(page)).toMatch(/^Ledger/)
    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)

    await expect.poll(() => page.getAttribute(CURRENCIES_TAB, 'aria-selected')).toBe('true')
  })

  test('Currencies chosen, then Ctrl+1, then Ctrl+2: the cursor is on the Currencies tab', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    await chooseCurrencies(page)

    press('ctrl+1')
    await expect.poll(() => current(page)).toMatch(/^Ledger/)
    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)

    await expect.poll(() => focusedTab(page)).toBe('Currencies')
  })

  test('Currencies chosen, then Ctrl+Shift+N: the Accounts tab is selected and the cursor is in Name', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    await chooseCurrencies(page)

    press('ctrl+shift+n')

    await expect.poll(() => page.getAttribute(ACCOUNTS_TAB, 'aria-selected')).toBe('true')
    await expect.poll(() => focusedIn(page)).toBe('Add an account name')
  })

  test('an account added, undone, Currencies chosen, then Ctrl+Shift+Z: the Accounts tab is selected and the account is the selected row', async () => {
    const { page, press } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await add(page, 'visa', 'card')
    await expect.poll(() => accounts(page)).toHaveLength(1)

    press('ctrl+z')
    await expect.poll(() => accounts(page)).toEqual([])
    await chooseCurrencies(page)

    press('ctrl+shift+z')

    await expect.poll(() => page.getAttribute(ACCOUNTS_TAB, 'aria-selected')).toBe('true')
    await expect.poll(() => selected(page)).toEqual(['visa'])
  })

  test('from there, the cursor is in the list, which shows what came back', async () => {
    const { page, press } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await add(page, 'visa', 'card')
    await expect.poll(() => accounts(page)).toHaveLength(1)

    press('ctrl+z')
    await expect.poll(() => accounts(page)).toEqual([])
    await chooseCurrencies(page)

    press('ctrl+shift+z')

    await expect.poll(() => focusedIn(page)).toBe('Accounts OL')
  })

  test('an account added, then Ctrl+Z, then a click on the Accounts tab, then Ctrl+Shift+Z: the cursor stays on the Accounts tab', async () => {
    const { page, press } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await add(page, 'visa', 'card')
    await expect.poll(() => accounts(page)).toHaveLength(1)

    press('ctrl+z')
    await expect.poll(() => accounts(page)).toEqual([])
    await page.click(ACCOUNTS_TAB)
    await expect.poll(() => focusedTab(page)).toBe('Accounts')

    press('ctrl+shift+z')

    await expect.poll(() => selected(page)).toEqual(['visa'])
    await expect.poll(() => focusedTab(page)).toBe('Accounts')
  })

  test("Ctrl+2 with the Accounts tab chosen: the page holds one Currencies panel, hidden, so the tab's aria-controls names it", async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)

    const panel = '#accounts-panel-currencies'
    await expect.poll(() => page.locator(panel).count()).toBe(1)
    await expect
      .poll(() => page.getAttribute(CURRENCIES_TAB, 'aria-controls'))
      .toBe('accounts-panel-currencies')
    await expect.poll(() => page.isVisible(panel)).toBe(false)
  })

  test("at 420 by 700, Accounts: both tabs are visible, and each tab's box ends inside the window", async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 420, height: 700 })
    await page.click(`${NAV} button:has-text("Accounts")`)

    for (const tab of [ACCOUNTS_TAB, CURRENCIES_TAB]) {
      await expect.poll(() => page.locator(tab).isVisible()).toBe(true)
      const box = await boxOf(page, tab)
      expect(box.x + box.width, tab).toBeLessThanOrEqual(420)
    }
  })
})

describe('adding an account', () => {
  test('a name, Card, its currency, Enter: it is in the list, selected, and says I owe it', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)

    await add(page, 'visa', 'card')

    await expect.poll(() => accounts(page)).toEqual(['visa | 0.00 CAD'])
    expect(await selected(page)).toEqual(['visa'])
    expect(await page.isVisible(ADDING)).toBe(false)
    expect(await page.locator(ACCOUNT).innerText()).toContain(
      'A credit card. Spending on it adds to what you owe.',
    )
    await expect.poll(() => focusedIn(page)).toBe('Accounts OL')
  })

  test('a loan is something I owe, like a card', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)

    await page.click(ADD_ACCOUNT)
    await page.selectOption(KIND, 'loan')
    expect(await page.locator(`${ADDING} #account-kind-note`).innerText()).toContain(
      'Money you owe',
    )

    await page.locator(NAME).focus()
    await page.keyboard.type('car')
    await page.keyboard.press('Enter')
    await expect.poll(() => accounts(page)).toEqual(['car | 0.00 CAD'])
  })

  test('a bank account, a card or a loan holds the one currency I pick, unless I say any', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await page.click(ADD_ACCOUNT)

    for (const kind of ['bank', 'card', 'loan']) {
      await page.selectOption(KIND, kind)
      expect(await page.inputValue(CURRENCY)).toBe('CAD')
    }
    await page.selectOption(CURRENCY, 'EUR')
    expect(await page.locator(`${ADDING} #account-currency-note`).innerText()).toBe(
      'It holds only EUR.',
    )
    await page.selectOption(CURRENCY, '')
    expect(await page.locator(`${ADDING} #account-currency-note`).innerText()).toBe(
      'It can hold any currency.',
    )
    await page.keyboard.press('Escape')

    await add(page, 'wise', 'bank', '')
    await expect.poll(() => accounts(page)).toEqual(['wise | 0.00 CAD'])
    await add(page, 'chequing', 'bank', 'USD')
    await expect.poll(() => accounts(page)).toHaveLength(2)
    expect(await accounts(page)).toContain('chequing | 0.00 USD')
  })

  test('cash can hold any currency', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await page.click(ADD_ACCOUNT)

    await page.selectOption(KIND, 'cash')
    expect(await page.inputValue(CURRENCY)).toBe('')

    await page.locator(NAME).focus()
    await page.keyboard.type('envelope')
    await page.keyboard.press('Enter')
    await expect.poll(() => accounts(page)).toEqual(['envelope | 0.00 CAD'])
  })

  test('a currency I picked stays picked when I change the kind', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await page.click(ADD_ACCOUNT)

    await page.selectOption(CURRENCY, 'JPY')
    await page.selectOption(KIND, 'cash')
    expect(await page.inputValue(CURRENCY)).toBe('JPY')
  })

  test('a name I already have is refused, and the form says why', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await page.click(`${NAV} button:has-text("Accounts")`)
    await add(page, 'Visa', 'card')
    await expect.poll(() => accounts(page)).toHaveLength(2)

    for (const name of ['visa', 'CASH']) {
      await add(page, name, 'bank')
      await expect
        .poll(() => page.locator(`${ADDING} [role=alert]`).innerText())
        .toBe('You already have an account with that name.')
      expect(await page.getAttribute(NAME, 'aria-invalid')).toBe('true')
      await expect.poll(() => focusedIn(page)).toBe('Add an account name')
      await page.keyboard.press('Escape')
    }
    expect(await accounts(page)).toEqual(['cash | −4.50 CAD', 'Visa | 0.00 CAD'])
  })

  test('with no name, it asks for one', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await page.click(ADD_ACCOUNT)
    await page.locator(NAME).focus()
    await page.keyboard.press('Enter')

    await expect
      .poll(() => page.locator(`${ADDING} [role=alert]`).innerText())
      .toBe('Give it a name.')
    expect(await accounts(page)).toEqual([])
  })

  test('Escape puts the pane away and adds nothing', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await page.click(ADD_ACCOUNT)
    await page.locator(NAME).focus()
    await page.keyboard.type('visa')
    await page.keyboard.press('Escape')

    expect(await page.isVisible(ADDING)).toBe(false)
    expect(await accounts(page)).toEqual([])
  })

  test('Ctrl+Shift+N from Spends goes to Accounts with the cursor in Name', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+shift+n')

    await expect.poll(() => focusedIn(page)).toBe('Add an account name')
    expect(await current(page)).toMatch(/^Accounts/)
  })

  test('in a narrow window the pane slides over the list, and the places go across the top', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 420, height: 700 })
    await page.click(`${NAV} button:has-text("Accounts")`)

    const pane = page.locator(ACCOUNT)
    await expect.poll(() => pane.isVisible()).toBe(false)

    await page.click(ADD_ACCOUNT)
    await expect.poll(() => pane.isVisible()).toBe(true)
    await expect.poll(() => focusedIn(page)).toBe('Add an account name')

    await page.click(`${ACCOUNT} >> ${BACK}`)
    await expect.poll(() => pane.isVisible()).toBe(false)
    expect(await accounts(page)).toEqual([])

    const [spends, accountsButton] = await page.locator(`${NAV} button`).all()
    const a = await spends?.boundingBox()
    const b = await accountsButton?.boundingBox()
    expect(a?.y).toBe(b?.y)
  })
})

describe('undoing an account added', () => {
  test('Ctrl+Z takes it back; Ctrl+Shift+Z puts it back, selected', async () => {
    const { page, press } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await add(page, 'visa', 'card')
    await expect.poll(() => accounts(page)).toHaveLength(1)

    press('ctrl+z')
    await expect.poll(() => accounts(page)).toEqual([])

    press('ctrl+shift+z')
    await expect.poll(() => accounts(page)).toEqual(['visa | 0.00 CAD'])
    await expect.poll(() => selected(page)).toEqual(['visa'])
  })

  test('undone from Spends, Accounts shows, so you see what moved', async () => {
    const { page, press } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await add(page, 'visa', 'card')
    await expect.poll(() => accounts(page)).toHaveLength(1)
    press('ctrl+1')
    await expect.poll(() => current(page)).toMatch(/^Ledger/)
    // Ctrl+1 leaves the cursor in the amount field; a field just entered gives Ctrl+Z to the ledger.

    press('ctrl+z')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    expect(await accounts(page)).toEqual([])
  })
})
