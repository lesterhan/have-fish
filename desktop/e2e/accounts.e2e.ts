// Adding a bank account or card, from the Accounts place: Entry-11's acceptance, with real keys.

import type { Page } from 'playwright-core'
import { describe, expect, test } from 'vitest'
import { aHome, launch, PANE, rows, writeDown } from './app'

const NAV = 'nav[aria-label=Places]'
const LIST = 'ol[aria-label=Accounts]'
const ACCOUNT = 'section[aria-label="The account"]'
const ADDING = `${ACCOUNT} form[aria-label="Add an account"]`
const NAME = `${ADDING} input[name=name]`
const KIND = `${ADDING} select[name=kind]`
const CURRENCY = `${ADDING} select[name=currency]`

/** The accounts list as text: name, kind, currency, balance. */
const accounts = (page: Page) =>
  page
    .locator(`${LIST} li`)
    .evaluateAll((items) =>
      items.map((li) => [...li.children].map((c) => c.textContent?.trim() ?? '').join(' | ')),
    )
const selected = (page: Page) =>
  page.locator(`${LIST} li[aria-selected=true] .name`).allTextContents()
const current = (page: Page) => page.locator(`${NAV} [aria-current=page]`).innerText()
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    const where = el?.closest('form, section, ol, nav, main')?.getAttribute('aria-label')
    return `${where} ${el?.getAttribute('name') ?? el?.tagName}`
  })

/** Add account, a name, a kind and maybe a currency, Enter: as a person does it. */
async function add(page: Page, name: string, kind: string, currency?: string) {
  await page.click(`main.accounts button.add`)
  await page.locator(NAME).focus()
  await page.keyboard.type(name)
  await page.selectOption(KIND, kind)
  if (currency !== undefined) await page.selectOption(CURRENCY, currency)
  await page.locator(NAME).focus()
  await page.keyboard.press('Enter')
}

describe('the places', () => {
  test('Spends and Accounts down the left; Ctrl+2 and Ctrl+1 go between them', async () => {
    const { page, press } = await launch(aHome())
    expect(await page.locator(`${NAV} button`).allInnerTexts()).toEqual([
      expect.stringMatching(/^Spends\s+Ctrl\+1$/),
      expect.stringMatching(/^Accounts\s+Ctrl\+2$/),
    ])
    expect(await current(page)).toMatch(/^Spends/)

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    expect(await page.isVisible(LIST)).toBe(true)
    expect(await page.isVisible('ol[aria-label=Spends]')).toBe(false)

    press('ctrl+1')
    await expect.poll(() => current(page)).toMatch(/^Spends/)
    expect(await focused(page)).toBe('Write down a spend amount')
  })

  test('the wallet the first spend made is already there, as cash', async () => {
    const { page } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)

    await page.click(`${NAV} button:has-text("Accounts")`)
    await expect.poll(() => accounts(page)).toEqual(['cash | Cash | Any currency | -4.50 CAD'])
  })

  test('an unsaved change on a spend is still there after a visit to Accounts', async () => {
    const { page, press } = await launch(aHome())
    await writeDown(page, '4.50', 'Coffee')
    await expect.poll(() => rows(page)).toHaveLength(1)
    await page.fill(`${PANE} input[name=description]`, 'Coffee and cake')

    press('ctrl+2')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    press('ctrl+1')
    await expect.poll(() => current(page)).toMatch(/^Spends/)

    expect(await page.inputValue(`${PANE} input[name=description]`)).toBe('Coffee and cake')
    expect((await rows(page))[0]).toContain('●')
  })
})

describe('adding an account', () => {
  test('a name, Card, its currency, Enter: it is in the list, selected, and says I owe it', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)

    await add(page, 'visa', 'card')

    await expect.poll(() => accounts(page)).toEqual(['visa | Card | CAD | 0.00 CAD'])
    expect(await selected(page)).toEqual(['visa'])
    expect(await page.isVisible(ADDING)).toBe(false)
    expect(await page.locator(ACCOUNT).innerText()).toContain(
      'A credit card. Spending on it adds to what you owe.',
    )
    expect(await focused(page)).toBe('Accounts OL')
  })

  test('a loan is something I owe, like a card', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)

    await page.click('main.accounts button.add')
    await page.selectOption(KIND, 'loan')
    expect(await page.locator(`${ADDING} #kind-hint`).innerText()).toContain('Money you owe')

    await page.locator(NAME).focus()
    await page.keyboard.type('car')
    await page.keyboard.press('Enter')
    await expect.poll(() => accounts(page)).toEqual(['car | Loan | CAD | 0.00 CAD'])
  })

  test('a bank account, a card or a loan holds the one currency I pick, unless I say any', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await page.click('main.accounts button.add')

    for (const kind of ['bank', 'card', 'loan']) {
      await page.selectOption(KIND, kind)
      expect(await page.inputValue(CURRENCY)).toBe('CAD')
    }
    await page.selectOption(CURRENCY, 'EUR')
    expect(await page.locator(`${ADDING} #currency-hint`).innerText()).toBe('It holds only EUR.')
    await page.selectOption(CURRENCY, '')
    expect(await page.locator(`${ADDING} #currency-hint`).innerText()).toBe(
      'It can hold any currency.',
    )
    await page.keyboard.press('Escape')

    await add(page, 'wise', 'bank', '')
    await expect
      .poll(() => accounts(page))
      .toEqual(['wise | Bank account | Any currency | 0.00 CAD'])
    await add(page, 'chequing', 'bank', 'USD')
    await expect.poll(() => accounts(page)).toHaveLength(2)
    expect(await accounts(page)).toContain('chequing | Bank account | USD | 0.00 USD')
  })

  test('cash can hold any currency', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await page.click('main.accounts button.add')

    await page.selectOption(KIND, 'cash')
    expect(await page.inputValue(CURRENCY)).toBe('')

    await page.locator(NAME).focus()
    await page.keyboard.type('envelope')
    await page.keyboard.press('Enter')
    await expect.poll(() => accounts(page)).toEqual(['envelope | Cash | Any currency | 0.00 CAD'])
  })

  test('a currency I picked stays picked when I change the kind', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await page.click('main.accounts button.add')

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
      expect(await focused(page)).toBe('Add an account name')
      await page.keyboard.press('Escape')
    }
    expect(await accounts(page)).toEqual([
      'cash | Cash | Any currency | -4.50 CAD',
      'Visa | Card | CAD | 0.00 CAD',
    ])
  })

  test('with no name, it asks for one', async () => {
    const { page } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await page.click('main.accounts button.add')
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
    await page.click('main.accounts button.add')
    await page.locator(NAME).focus()
    await page.keyboard.type('visa')
    await page.keyboard.press('Escape')

    expect(await page.isVisible(ADDING)).toBe(false)
    expect(await accounts(page)).toEqual([])
  })

  test('Ctrl+Shift+N from Spends goes to Accounts with the cursor in Name', async () => {
    const { page, press } = await launch(aHome())

    press('ctrl+shift+n')

    await expect.poll(() => focused(page)).toBe('Add an account name')
    expect(await current(page)).toMatch(/^Accounts/)
  })

  test('in a narrow window the pane slides over the list, and the places go across the top', async () => {
    const { page } = await launch(aHome())
    await page.setViewportSize({ width: 420, height: 700 })
    await page.click(`${NAV} button:has-text("Accounts")`)

    const pane = page.locator(ACCOUNT)
    await expect.poll(() => pane.isVisible()).toBe(false)

    await page.click('main.accounts button.add')
    await expect.poll(() => pane.isVisible()).toBe(true)
    expect(await focused(page)).toBe('Add an account name')

    await page.click(`${ACCOUNT} button.back`)
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
    await expect.poll(() => accounts(page)).toEqual(['visa | Card | CAD | 0.00 CAD'])
    await expect.poll(() => selected(page)).toEqual(['visa'])
  })

  test('undone from Spends, Accounts shows, so you see what moved', async () => {
    const { page, press } = await launch(aHome())
    await page.click(`${NAV} button:has-text("Accounts")`)
    await add(page, 'visa', 'card')
    await expect.poll(() => accounts(page)).toHaveLength(1)
    press('ctrl+1')
    await expect.poll(() => current(page)).toMatch(/^Spends/)
    // Ctrl+1 leaves the cursor in the amount field; a field just entered gives Ctrl+Z to the ledger.

    press('ctrl+z')
    await expect.poll(() => current(page)).toMatch(/^Accounts/)
    expect(await accounts(page)).toEqual([])
  })
})
