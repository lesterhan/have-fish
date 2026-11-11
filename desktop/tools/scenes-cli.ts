// The impure half of the shots: a browser over the built scenes for the pictures, and git and
// ImageMagick over them for what a change moved. Every rule a test can hold is in shots.ts.
//
//   bun tools/scenes-cli.ts shots            every scene at three sizes, light and dark
//   bun tools/scenes-cli.ts gallery          one folder of static files over those shots
//   bun tools/scenes-cli.ts diff <base>      the branch and the base, one page of what moved

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type LaunchOptions, type Page } from 'playwright-core'
import { SCENES } from '../scenes/scenes'
import { SCENES_OUT } from '../vite.scenes.config'
import {
  type Change,
  changedShots,
  diffPage,
  fileOf,
  galleryPage,
  type Shot,
  SIZES,
  shotsOf,
  THEMES,
} from './shots'

const DESKTOP = resolve(import.meta.dirname, '..')
const SHOTS = join(SCENES_OUT, 'shots')
const GALLERY = join(SCENES_OUT, 'gallery')
const DIFF = join(SCENES_OUT, 'diff')

/** Chromium refuses its sandbox as root, which is how CI containers run. */
const SANDBOX = process.env.NO_SANDBOX === '1' ? ['--no-sandbox'] : []

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/**
 * A built folder over loopback: a browser loads its page of ES modules from a server and not
 * from disk. Nothing leaves the machine.
 */
export function serve(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname)
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`)
    if (relative(root, file).startsWith('..')) {
      response.writeHead(403).end()
      return
    }
    // Read before the head: a missing file is a 404, not a head already sent.
    let body: Buffer
    try {
      body = readFileSync(file)
    } catch {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  })
  return new Promise((settle, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        fail(new Error('the scene server took no port'))
        return
      }
      settle({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closed) => server.close(() => closed())),
      })
    })
  })
}

/** A browser to try: its name for the message, and how Playwright launches it. */
export type BrowserTry = { name: string; options: LaunchOptions }

/** Playwright's Chromium where it is installed, else the machine's Chrome. */
const TRIES: readonly BrowserTry[] = [
  { name: "Playwright's Chromium", options: {} },
  { name: 'Chrome', options: { channel: 'chrome' } },
]

/** The first browser that launches, or null after saying which it tried. */
export async function launch(tries: readonly BrowserTry[] = TRIES): Promise<Browser | null> {
  const missed: string[] = []
  for (const { name, options } of tries) {
    try {
      return await chromium.launch({ ...options, args: SANDBOX })
    } catch (error) {
      missed.push(`${name}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
  console.error('No browser to shoot with.')
  for (const line of missed) console.error(`  ${line}`)
  console.error("Install Playwright's Chromium or Chrome, then run this again.")
  return null
}

/** The scenes the built index links to: each side's own scene list, never the other's. */
async function sceneNames(page: Page, url: string): Promise<string[]> {
  await page.goto(`${url}/`)
  await page.waitForSelector('#app a')
  return page.locator('#app a').allTextContents()
}

/** Whether a built side says when a scene is drawn; a base older than the marker does not. */
async function probed(browser: Browser, url: string): Promise<boolean> {
  const page = await browser.newPage()
  try {
    const first = (await sceneNames(page, url))[0]
    if (first === undefined) return false
    await page.goto(`${url}/?scene=${encodeURIComponent(first)}`)
    try {
      await page.waitForSelector('body[data-scene=ready]', { timeout: 5_000 })
      return true
    } catch {
      return false
    }
  } finally {
    await page.close()
  }
}

/**
 * Waits until nothing animates and two frames have drawn. A pane sliding in leaves the edges of
 * its fields a hair different, and its layer settles a frame after the animation ends; so does a
 * theme switch.
 */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().length === 0)
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  )
}

/** Waits until the scene is drawn, and the fonts are in. */
async function drawn(page: Page, marked: boolean): Promise<void> {
  if (marked) {
    await page.waitForSelector('body[data-scene=ready]', { timeout: 30_000 })
  } else {
    // No marker: the page quiets down once its steps have run, then a frame draws it.
    await page.waitForLoadState('networkidle')
    await page.waitForFunction(() => document.fonts.status === 'loaded')
  }
  await settled(page)
}

/** Every scene at every size and theme, written under `out`; the shots it wrote. */
async function shoot(browser: Browser, url: string, out: string, marked: boolean): Promise<Shot[]> {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const page = await browser.newPage()
  try {
    const scenes = await sceneNames(page, url)
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height })
      for (const scene of scenes) {
        await page.goto(`${url}/?scene=${encodeURIComponent(scene)}`)
        await drawn(page, marked)
        for (const theme of THEMES) {
          await page.emulateMedia({ colorScheme: theme })
          await settled(page)
          await page.screenshot({
            path: join(out, fileOf(scene, size.name, theme)),
            animations: 'disabled',
          })
        }
      }
    }
    return shotsOf(scenes)
  } finally {
    await page.close()
  }
}

/** A command's output, or an error naming it: a build that fails must not read as a shot run. */
function run(command: string, args: string[], cwd: string, quiet = false): void {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })
  if (result.status !== 0) {
    const said = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status ?? 'no exit'})${said ? `:\n${said}` : ''}`,
    )
  }
  if (!quiet && result.stdout) process.stdout.write(result.stdout)
}

/** What a command answers, its output trimmed; throws when it fails. */
function text(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')}: ${result.stderr.trim() || result.status}`)
  }
  return result.stdout.trim()
}

/** `bun run scenes:shots`: the branch built fresh, then every scene shot into shots/. */
async function shots(): Promise<void> {
  run('bun', ['run', 'scenes'], DESKTOP)
  const browser = await launch()
  if (browser === null) throw new Error('no browser to shoot with')
  const server = await serve(SCENES_OUT)
  try {
    const written = await shoot(browser, server.url, SHOTS, true)
    console.log(`shots: ${written.length} in ${relative(DESKTOP, SHOTS)}/`)
  } finally {
    await browser.close()
    await server.close()
  }
}

/** `bun run scenes:gallery`: the shots and a page over them, and nothing else in the folder. */
function gallery(): void {
  const shots = shotsOf(SCENES.map((scene) => scene.name))
  const missing = shots.filter((shot) => !existsSync(join(SHOTS, shot.file)))
  if (missing.length > 0) {
    throw new Error(`gallery: ${missing.length} shots missing; run bun run scenes:shots first`)
  }
  rmSync(GALLERY, { recursive: true, force: true })
  mkdirSync(GALLERY, { recursive: true })
  for (const shot of shots) cpSync(join(SHOTS, shot.file), join(GALLERY, shot.file))
  writeFileSync(join(GALLERY, 'index.html'), galleryPage(shots))
  console.log(`gallery: ${shots.length} shots in ${relative(DESKTOP, GALLERY)}/`)
}

/** Whether ImageMagick's compare is here to say what pixels differ. */
const canCompare = (): boolean => spawnSync('compare', ['-version']).status === 0

/** The pixels that differ between two shots, writing their difference to `out`. */
export function pixelsDifferent(before: string, after: string, out: string): number {
  const result = spawnSync('compare', ['-metric', 'AE', before, after, out], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`compare ${before} ${after}: ${result.stderr.trim()}`)
  }
  // `-metric AE` says the count, then the count over the pixels: `100 (1)`.
  const said = (result.stderr || result.stdout).trim()
  const count = Number.parseInt(said, 10)
  if (Number.isNaN(count)) throw new Error(`compare ${before} ${after}: ${said}`)
  return count
}

/**
 * The shots of one side, over that side's own build. The branch always waits for its ready
 * marker; only the base is probed, since a base older than the marker has none.
 */
async function side(browser: Browser, root: string, out: string, base = false): Promise<Shot[]> {
  const server = await serve(root)
  try {
    const marked = base ? await probed(browser, server.url) : true
    return await shoot(browser, server.url, out, marked)
  } finally {
    await server.close()
  }
}

/**
 * The base built in a worktree of its own under the temp folder, handed to `then`, and removed
 * however that ends.
 */
async function withBase<T>(base: string, then: (desktop: string) => Promise<T>): Promise<T> {
  const parent = mkdtempSync(join(tmpdir(), 'have-fish-diff-'))
  const worktree = join(parent, 'base')
  const repo = text('git', ['rev-parse', '--show-toplevel'], DESKTOP)
  try {
    run('git', ['worktree', 'add', '--detach', worktree, base], repo)
    // The base's own packages from bun's cache, so its core is the base's, not the branch's.
    run('bun', ['install', '--frozen-lockfile', '--offline'], worktree, true)
    run('bun', ['run', 'scenes'], join(worktree, 'desktop'))
    return await then(join(worktree, 'desktop'))
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: repo })
    rmSync(parent, { recursive: true, force: true })
  }
}

/**
 * `bun run scenes:diff <base>`: the branch and the base each shot, then one page of only the
 * shots that moved. A report, so it exits 0 whatever moved.
 */
async function diff(base: string): Promise<void> {
  run('bun', ['run', 'scenes'], DESKTOP)
  const browser = await launch()
  if (browser === null) throw new Error('no browser to shoot with')
  const temp = mkdtempSync(join(tmpdir(), 'have-fish-shots-'))
  const branchOut = join(temp, 'branch')
  const baseOut = join(temp, 'base')
  const compared = join(temp, 'compare')
  try {
    const branch = await side(browser, SCENES_OUT, branchOut)
    const older = await withBase(base, (desktop) =>
      side(browser, join(desktop, 'scenes-out'), baseOut, true),
    )
    const baseFiles = older.map((shot) => shot.file)
    const branchFiles = branch.map((shot) => shot.file)
    const shared = baseFiles.filter((file) => branchFiles.includes(file)).sort()
    const lit = canCompare()
    let differing: Record<string, number> | undefined
    if (lit) {
      differing = {}
      mkdirSync(compared, { recursive: true })
      for (const file of shared) {
        differing[file] = pixelsDifferent(
          join(baseOut, file),
          join(branchOut, file),
          join(compared, file),
        )
      }
    } else {
      console.log(
        'diff: no ImageMagick compare, so before and after only, nothing marked different',
      )
    }
    const change: Change = changedShots(baseFiles, branchFiles, differing)
    rmSync(DIFF, { recursive: true, force: true })
    const copies: [string, string, string[]][] = [
      ['base', baseOut, [...change.changed, ...change.gone]],
      ['branch', branchOut, [...change.changed, ...change.added]],
    ]
    if (lit) copies.push(['diff', compared, change.changed])
    for (const [name, from, files] of copies) {
      mkdirSync(join(DIFF, name), { recursive: true })
      for (const file of files) cpSync(join(from, file), join(DIFF, name, file))
    }
    writeFileSync(join(DIFF, 'index.html'), diffPage(change, lit))
    console.log(
      `diff: ${change.changed.length} changed, ${change.added.length} added, ` +
        `${change.gone.length} gone; ${relative(DESKTOP, DIFF)}/index.html`,
    )
  } finally {
    await browser.close()
    rmSync(temp, { recursive: true, force: true })
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

async function main(): Promise<void> {
  const [command, base] = process.argv.slice(2)
  if (command === 'shots') await shots()
  else if (command === 'gallery') gallery()
  else if (command === 'diff' && base !== undefined) await diff(base)
  else throw new Error('usage: bun tools/scenes-cli.ts shots | gallery | diff <base>')
}

if (isMain) {
  try {
    await main()
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
