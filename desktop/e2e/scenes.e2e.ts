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

const SPENDS = 'ol[aria-label=Ledger]'
const WRITE = 'form[aria-label="Write down a spend"]'
const PANE = 'section[aria-label="The spend"]'
const ACCOUNTS = 'ol[aria-label=Accounts]'
const TREE = 'ol[aria-label="Spending by category"]'

/** The year's fixture, as `scenes:record` wrote it. */
const year = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'scenes', 'fixtures', 'year.json'), 'utf8'),
) as Fixture

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
