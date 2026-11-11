// The scenes, each opened in a window of its own through scenes-main.ts: the real window over a
// recorded fixture, no Electron main behind it. The scene is the SCENE variable. `bun run e2e`
// records and builds the scenes first; `bun run e2e scenes` runs this file alone.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, type Page } from 'playwright-core'
import { expect, onTestFinished, test } from 'vitest'
import { copy } from '../copy'
import type { Fixture } from '../scenes/fixture'
import { SCENES } from '../scenes/scenes'
import { PANE, WRITE } from './app'

const SPENDS = 'ol[aria-label=Ledger]'
const ACCOUNTS = 'ol[aria-label=Accounts]'
const TREE = 'ol[aria-label="Spending by category"]'
const PALETTE = '[role=dialog][aria-label="Do anything"]'
const FROM_OPTIONS = `${WRITE} [role=listbox][aria-label="Your accounts and income"]`
const ADDING = 'section[aria-label="The account"] form[aria-label="Add an account"]'

/** The fixtures, as `scenes:record` wrote them. */
const fixtureOf = (profile: string): Fixture =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'scenes', 'fixtures', `${profile}.json`), 'utf8'),
  ) as Fixture
const year = fixtureOf('year')

/** The scene named by `name` in a window of its own; none named, the index of scenes. */
async function openScene(name?: string): Promise<Page> {
  const app = await electron.launch({
    args: [
      join(import.meta.dirname, 'scenes-main.ts'),
      ...(process.env.NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, ...(name === undefined ? {} : { SCENE: name }), NODE_OPTIONS: '' },
  })
  onTestFinished(() => app.close())
  return app.firstWindow()
}

test('ledger/year lists the fixture’s rows', async () => {
  const page = await openScene('ledger/year')
  const first = page.locator(`${SPENDS} li`).first()
  await first.waitFor()
  expect(await first.getAttribute('aria-setsize')).toBe(String(year.rows.length))
})

test('ledger/starter lists the starter fixture’s rows', async () => {
  const page = await openScene('ledger/starter')
  const first = page.locator(`${SPENDS} li`).first()
  await first.waitFor()
  expect(await first.getAttribute('aria-setsize')).toBe(String(fixtureOf('starter').rows.length))
})

test('ledger/empty shows the line, as on a first run', async () => {
  const page = await openScene('ledger/empty')
  await page.locator(WRITE).waitFor()
})

test('a write in a scene is refused in the window’s own words, and nothing is written', async () => {
  const page = await openScene('ledger/empty')
  await page.locator(WRITE).waitFor()
  await page.fill(`${WRITE} input[name=amount]`, '5')
  await page.locator(`${WRITE} input[name=amount]`).press('Enter')
  const alert = page.locator(`${WRITE} [role=alert]`)
  await alert.waitFor()
  expect(await alert.textContent()).toContain(copy.spends.composer.refused.form)
  expect(await page.locator(`${SPENDS} li`).count()).toBe(0)
})

test('ledger/spend-open shows the spend’s details', async () => {
  const page = await openScene('ledger/spend-open')
  await page.locator(PANE).waitFor()
})

test('ledger/compact is Compact', async () => {
  const page = await openScene('ledger/compact')
  await page.locator(`${SPENDS} li`).first().waitFor()
  expect(await page.locator('html').getAttribute('data-density')).toBe('compact')
})

test('accounts/year lists the fixture’s accounts, their parents among them', async () => {
  const page = await openScene('accounts/year')
  await page.locator(`${ACCOUNTS} li`).first().waitFor()
  expect(await page.locator(`${ACCOUNTS} li`).count()).toBeGreaterThanOrEqual(year.accounts.length)
})

test('reports/year reads the fixture’s last week as this week', async () => {
  const page = await openScene('reports/year')
  await page.locator(`${TREE} li`).first().waitFor()
  await expect
    .poll(() => page.locator('[role=group] strong').textContent())
    .toBe(copy.reports.week.thisWeek)
})

test('reports/category-open has a row open and a row a level under', async () => {
  const page = await openScene('reports/category-open')
  await page.locator(`${TREE} li`).first().waitFor()
  expect(await page.locator(`${TREE} li[aria-expanded=true]`).count()).toBe(1)
  expect(await page.locator(`${TREE} li[aria-level='2']`).count()).toBeGreaterThan(0)
})

test('with no scene named, a link to each', async () => {
  const page = await openScene()
  const links = page.locator('#app a')
  expect(await links.count()).toBe(SCENES.length)
  expect(await links.allTextContents()).toEqual(SCENES.map((scene) => scene.name))
})

test('each new scene opens on what it names', { timeout: 120_000 }, async () => {
  const palette = await openScene('ledger/palette')
  await palette.locator(`${PALETTE} [role=listbox]`).waitFor()

  const picker = await openScene('ledger/path-picker')
  await picker.locator(`${FROM_OPTIONS} [role=option]`).first().waitFor()

  const refused = await openScene('ledger/refused')
  await expect
    .poll(() => refused.locator(`${WRITE} [role=alert]`).textContent())
    .toContain(copy.spends.composer.refused.form)

  const chip = await openScene('ledger/chip-changing')
  await chip.locator(`${PANE} input[name=amount]`).waitFor()

  const adding = await openScene('accounts/adding')
  await adding.locator(ADDING).waitFor()

  const typing = await openScene('ledger/composer-typing')
  await typing.locator(`${WRITE} input[name=description]`).waitFor()
  expect(await typing.inputValue(`${WRITE} input[name=amount]`)).toBe('12.50')
  expect(await typing.inputValue(`${WRITE} input[name=description]`)).toBe('Lunch')
})

test('a scene says it is ready once its steps have run and its fonts loaded', async () => {
  const page = await openScene('ledger/palette')
  await page.waitForSelector('body[data-scene=ready]')
  // Ready comes after the steps: what they open is on the page too.
  await page.locator(`${PALETTE} [role=listbox]`).waitFor()
})
