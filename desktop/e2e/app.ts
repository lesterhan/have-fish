// Starts the built app (out/) against a throwaway home, so no test touches your real ledger.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from 'electron'
import { _electron, type ElectronApplication, type Page } from 'playwright-core'
import { onTestFinished } from 'vitest'

const desktop = join(import.meta.dirname, '..')

/** A folder standing in for the home directory; deleted when the test finishes. */
export function aHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'havefish-e2e-'))
  onTestFinished(() => rmSync(home, { recursive: true, force: true }))
  return home
}

/** Where a development run keeps its ledger, under `home`. */
export const ledgerDirIn = (home: string) => join(home, 'data', 'have-fish-dev')

export async function launch(home: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    executablePath: electron as unknown as string,
    // Chromium refuses to run its sandbox as root, which is how CI containers run.
    args: [desktop, ...(process.env.NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      NODE_OPTIONS: '',
    },
  })
  let closed = false
  app.on('close', () => {
    closed = true
  })
  onTestFinished(async () => {
    if (!closed) await app.close()
  })
  const page = await app.firstWindow()
  await page.waitForSelector('input[name=amount]')
  return { app, page }
}

/** Types a spend the way a person does: amount, Tab, what for, Enter. */
export async function writeDown(page: Page, amount: string, description: string): Promise<void> {
  await page.locator('input[name=amount]').focus()
  await page.keyboard.type(amount)
  await page.keyboard.press('Tab')
  await page.keyboard.type(description)
  await page.keyboard.press('Enter')
}

/** The list as text, one row per entry: date, description, amount. */
export const rows = (page: Page) =>
  page
    .locator('ol[aria-label=Spends] li')
    .evaluateAll((items) =>
      items.map((li) => [...li.children].map((c) => c.textContent?.trim() ?? '').join(' | ')),
    )
