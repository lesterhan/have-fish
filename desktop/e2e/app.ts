// Starts the app against a throwaway home, so no test touches your real ledger, and reaches its
// window over Chrome's DevTools protocol. That works the same for out/ and for a packaged binary,
// whose fuses turn off the `--inspect` that Playwright's own Electron launcher needs.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'
import { chromium, type Locator, type Page } from 'playwright-core'
import { onTestFinished } from 'vitest'
import { day, todayIn } from '../renderer/format'

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

/** The app's folder name: a packaged build's, or a dev run's. */
const appName = packaged ? 'have-fish' : 'have-fish-dev'

/** Where the app keeps its ledger, under `home`. */
export const ledgerDirIn = (home: string) => join(home, 'data', appName)

/** Where the app keeps this machine's settings (`settings.json`), under `home`. */
export const settingsDirIn = (home: string) => join(home, 'config', appName)

/** How to start the app as a person would, for `home`, with any `extra` environment. */
export function commandFor(home: string, extra: Record<string, string> = {}) {
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
      ...extra,
    },
  }
}

export type Running = {
  page: Page
  /** How many windows are open. */
  windows(): number
  /**
   * Presses keys on the keyboard, as xdotool names them (`ctrl+n`). Playwright's own keys come
   * through DevTools, which Electron's menu never sees.
   */
  press(keys: string): void
  /** Closes the window, as a person quits, and waits for the app to exit. */
  quit(): Promise<void>
}

export async function launch(home: string, extra?: Record<string, string>): Promise<Running> {
  const { exe, args, env } = commandFor(home, extra)
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
  // Playwright pins a page it connects to at light; the app's theme decides instead.
  await page.emulateMedia({ colorScheme: null })
  await page.waitForSelector('nav[aria-label=Places]')
  // The page is ready before the window shows (see #582); keys need the window on screen.
  await page.waitForFunction(() => document.visibilityState === 'visible')
  // The waits above keep the default 30s for a cold start; a test's give up at 10s.
  page.setDefaultTimeout(10_000)

  return {
    page,
    windows: () => context.pages().length,
    press: (keys) => pressKeys(child, keys),
    async quit() {
      await page.close()
      await exited
    },
  }
}

/** Real key presses on the app's X window: xdotool, under xvfb-run. */
function pressKeys(child: ChildProcess, keys: string): void {
  const xdotool = (...args: string[]) =>
    execFileSync('xdotool', args, { encoding: 'utf8', timeout: 10_000, stdio: 'pipe' })
  const window = findWindow(child, xdotool)
  xdotool('windowfocus', '--sync', window)
  xdotool('key', '--clearmodifiers', keys)
}

/**
 * The app's visible X window. Searched again until it's there: on a cold start the window can be
 * slow to show, and a search that meets a window as it's made or destroyed fails with BadWindow.
 */
function findWindow(child: ChildProcess, xdotool: (...args: string[]) => string): string {
  const deadline = Date.now() + 30_000
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const found = xdotool('search', '--onlyvisible', '--pid', String(child.pid)).split('\n')[0]
      if (found) return found
    } catch (e) {
      // None yet, or BadWindow from a window in flux: look again.
      last = e
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  throw new Error('pressing keys needs xdotool, and the app on an X display (xvfb-run -a)', {
    cause: last,
  })
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

// Elements are found by role and accessible name, never by class, so a restyle can't break a
// test about behaviour. `selectors.test.ts` holds the suite to it.

/** Add account, where the accounts are listed: it opens the form. */
export const ADD_ACCOUNT = 'role=button[name="Add account"s]'
/** The button that closes a pane, scoped to its pane. */
export const BACK = 'role=button[name="Back to the list"s]'

/** The line that writes a spend, open above the ledger's today. */
export const WRITE = 'form[aria-label="Write down a spend"]'
/** The batch under the line: the spends this opening of the line has written. */
export const BATCH = 'ol[aria-label="Just written"]'

/** Opens the line if it isn't open, then puts the cursor in its amount. */
export async function openComposer(page: Page): Promise<void> {
  if ((await page.locator(WRITE).count()) === 0) {
    await page.getByRole('button', { name: /\+ New/ }).click()
  }
  await page.locator(`${WRITE} input[name=amount]`).waitFor()
  // The line takes the cursor once it's drawn; a test can then move it where it wants.
  await page.waitForFunction(
    () => document.activeElement?.closest('form[aria-label="Write down a spend"]') !== null,
  )
}
/** A spend's details, open under its row in the ledger. */
export const PANE = 'section[aria-label="The spend"]'

/** Opens a spend's details as a person does: a click selects its row, and another opens it. */
export async function openSpend(row: Locator, card = PANE): Promise<void> {
  await row.click()
  await row.click()
  await row.page().waitForSelector(card)
}

/** Each row's cells as text, in reading order: the row as a person sees it. */
export const cellsOf = (rows: Locator) =>
  rows.evaluateAll((items) =>
    items.map((row) => [...row.children].map((c) => c.textContent?.trim() ?? '')),
  )

/** A path picker's options as whole paths: `expenses:food`, or the path a new one would make. */
export const offeredPaths = (options: Locator) =>
  options.evaluateAll((items) =>
    items.map(
      (option) =>
        option.querySelector('[data-path]')?.getAttribute('data-path') ??
        option.querySelector('[data-create]')?.getAttribute('data-create') ??
        '',
    ),
  )

/** An open spend's chip for one part: `amount`, `description`, `from`, `date` or `to`. */
export const chip = (part: string, card = PANE) => `${card} [id$="-chip-${part}"]`

/** Opens a chip in an open spend's details: a click, as a person does it. */
export async function openChip(page: Page, part: string, card = PANE) {
  await page.click(chip(part, card))
  await page.waitForSelector(`${card} input[name=${part}], ${card} [role=combobox][name=${part}]`)
}

/** The details' From: the path the spend came out of, as words (`liabilities visa`). */
export const fromLine = (page: Page) => page.locator(`${chip('from')}`)

/** Opens the selected spend's details with Enter on its list, as the keys do. */
export async function openSelected(page: Page, list = 'ol[aria-label=Ledger]', card = PANE) {
  await page.focus(list)
  await page.keyboard.press('Enter')
  await page.waitForSelector(card)
}

/**
 * Types a spend the way a person does: + New, amount, Tab, what for, Enter, then Esc. The line
 * stays open after Enter, its spend in the batch under it; Esc closes it, waiting for that spend
 * to join the batch first, and returns once the line is gone.
 */
export async function writeDown(page: Page, amount: string, description: string): Promise<void> {
  await openComposer(page)
  await page.locator(`${WRITE} input[name=amount]`).focus()
  await page.keyboard.type(amount)
  await page.keyboard.press('Tab')
  await page.keyboard.type(description)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForSelector(WRITE, { state: 'detached' })
}

/** A day as the window shows it, today being today where this machine is. */
export const shownDay = (date: string) => day(date, todayIn())

/**
 * Spend rows as cells: the day, from the band above its first row; the description; the amount.
 * Rows found by role, cells by what they hold.
 */
export const spendCells = (rows: Locator) =>
  rows.evaluateAll((items) => {
    let day = ''
    return items.map((li) => {
      day = li.querySelector(':scope > div time')?.textContent?.trim() ?? day
      const cell = (name: string) =>
        li.querySelector(`[data-cell=${name}]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      return [day, cell('description'), cell('amount')]
    })
  })

/** The ledger as text, one row per spend: its day, description, amount. */
export const rows = (page: Page) =>
  spendCells(page.locator('ol[aria-label=Ledger] [role=option]')).then((all) =>
    all.map((cells) => cells.join(' | ')),
  )
