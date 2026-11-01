// Starts the app against a throwaway home, so no test touches your real ledger, and reaches its
// window over Chrome's DevTools protocol. That works the same for out/ and for a packaged binary,
// whose fuses turn off the `--inspect` that Playwright's own Electron launcher needs.

import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'
import { chromium, type Page } from 'playwright-core'
import { onTestFinished } from 'vitest'

const desktop = join(import.meta.dirname, '..')

/** A packaged app to test instead of out/: `E2E_APP=dist/linux-unpacked/have-fish`. */
const packaged = process.env.E2E_APP

/** A folder standing in for the home directory; deleted when the test finishes. */
export function aHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'havefish-e2e-'))
  // Retried: Chromium's helper processes can still be writing as the app exits.
  onTestFinished(() =>
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  )
  return home
}

/** Where the app keeps its ledger, under `home`. */
export const ledgerDirIn = (home: string) =>
  join(home, 'data', packaged ? 'have-fish' : 'have-fish-dev')

/** How to start the app as a person would, for `home`. */
export function commandFor(home: string) {
  return {
    exe: packaged ? resolve(packaged) : (electron as unknown as string),
    args: [
      ...(packaged ? [] : [desktop]),
      // Chromium refuses to run its sandbox as root, which is how CI containers run.
      ...(process.env.NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      NODE_OPTIONS: '',
    },
  }
}

export type Running = {
  page: Page
  /** How many windows are open. */
  windows(): number
  /** Closes the window, as a person quits, and waits for the app to exit. */
  quit(): Promise<void>
}

export async function launch(home: string): Promise<Running> {
  const { exe, args, env } = commandFor(home)
  const child = spawn(exe, [...args, '--remote-debugging-port=0'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const exited = once(child, 'exit')
  onTestFinished(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    const killer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    await exited
    clearTimeout(killer)
  })

  const browser = await chromium.connectOverCDP(await devtoolsUrl(child))
  const context = browser.contexts()[0]
  if (context === undefined) throw new Error('the app has no browser context')
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  await page.waitForSelector('input[name=amount]')

  return {
    page,
    windows: () => context.pages().length,
    async quit() {
      await page.close()
      await exited
    },
  }
}

/** Chromium prints where its DevTools listen, once they do. */
function devtoolsUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let seen = ''
    child.stderr?.on('data', (chunk) => {
      seen += String(chunk)
      const url = /DevTools listening on (ws:\/\/\S+)/.exec(seen)?.[1]
      if (url !== undefined) resolve(url)
    })
    child.once('exit', (code) => reject(new Error(`the app exited (${code}) before its window`)))
  })
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
