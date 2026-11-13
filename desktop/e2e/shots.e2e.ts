// The shots and the pages over them, run as a person runs them: the commands, the browser, git
// and ImageMagick. Needs the scenes built; the gate's e2e command builds them first.
//
// `scenes:diff` is run three times: against a base whose palette is rounder, against a ref that
// isn't there, and with no ImageMagick compare on the path. A diff is minutes, not seconds.

import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { SCENES } from '../scenes/scenes'
import { launch, pixelsDifferent, serve } from '../tools/scenes-cli'
import { sceneOf, shotsOf } from '../tools/shots'
import { SCENES_OUT } from '../vite.scenes.config'

const DESKTOP = resolve(import.meta.dirname, '..')
const REPO = resolve(DESKTOP, '..')
const SHOTS = join(SCENES_OUT, 'shots')
const GALLERY = join(SCENES_OUT, 'gallery')
const DIFF = join(SCENES_OUT, 'diff')
const FILES = shotsOf(SCENES.map((scene) => scene.name)).map((shot) => shot.file)

/** A command as a person runs it, its output on failure; throws when it fails. */
function run(...args: string[]): string {
  const result = spawnSync('bun', args, {
    cwd: DESKTOP,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    timeout: 600_000,
  })
  if (result.status !== 0) {
    throw new Error(`bun ${args.join(' ')}:\n${result.stdout}\n${result.stderr}`)
  }
  return `${result.stdout}${result.stderr}`
}

/** Leaves the shots the gallery needs, running the command when they aren't there. */
function withShots(): void {
  if (existsSync(SHOTS) && readdirSync(SHOTS).length === FILES.length) return
  run('run', 'scenes:shots')
}

/** The `<img>` sources a generated page holds, in the order it writes them. */
function sourcesOf(page: string): string[] {
  return [...page.matchAll(/<img src="([^"]+)"/g)].map((found) => found[1] ?? '')
}

/** The set of scenes a set of picture sources names, once each, sorted. */
const scenesOf = (sources: readonly string[]) =>
  [...new Set(sources.map((source) => sceneOf(source.replace(/^(base|branch|diff)\//, ''))))].sort()

/** The temp folders a diff makes: none of these may be left behind. */
const leftovers = () =>
  readdirSync(tmpdir()).filter(
    (name) => name.startsWith('have-fish-diff-') || name.startsWith('have-fish-shots-'),
  )

describe('the shots, as a person runs them', () => {
  test('scenes:shots writes eighty-four shots, each named by fileOf', { timeout: 600_000 }, () => {
    run('run', 'scenes:shots')
    expect(readdirSync(SHOTS).sort()).toEqual([...FILES].sort())
  })

  test('scenes:gallery writes the page and its shots, and nothing else', () => {
    withShots()
    run('run', 'scenes:gallery')
    const files = readdirSync(GALLERY).sort()
    expect(files.filter((file) => file.endsWith('.png'))).toEqual([...FILES].sort())
    expect(files.filter((file) => !file.endsWith('.png'))).toEqual(['index.html'])
    const page = readFileSync(join(GALLERY, 'index.html'), 'utf8')
    expect(page).not.toMatch(/<script\b|https?:/)
    expect(sourcesOf(page)).toEqual(FILES)
  })

  test("scenes:diff lists the palette's six shots in changed, and no other", {
    timeout: 900_000,
  }, () => {
    // A base of this branch with one part changed: a palette whose corners are rounder.
    const parent = mkdtempSync(join(tmpdir(), 'have-fish-palette-'))
    const worktree = join(parent, 'base')
    try {
      execFileSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: REPO })
      const file = join(worktree, 'desktop', 'renderer', 'shell', 'Palette.svelte')
      const source = readFileSync(file, 'utf8')
      const rounder = source.replace('border-radius: var(--radius-card);', 'border-radius: 2rem;')
      expect(rounder).not.toBe(source)
      writeFileSync(file, rounder)
      execFileSync(
        'git',
        [
          '-c',
          'user.name=have-fish',
          '-c',
          'user.email=tests@have-fish.local',
          'commit',
          '-q',
          '-a',
          '-m',
          'a rounder palette',
        ],
        { cwd: worktree },
      )
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' })
      run('run', 'scenes:diff', base.trim())

      const page = readFileSync(join(DIFF, 'index.html'), 'utf8')
      const sources = sourcesOf(page)
      const changed = sources.filter((src) => src.startsWith('base/'))
      expect(changed).toHaveLength(6)
      expect(scenesOf(changed)).toEqual(['ledger/palette'])
      expect(sources.filter((src) => src.startsWith('diff/'))).toHaveLength(6)
      expect(page).not.toContain('<h2>Added</h2>')
      expect(page).not.toContain('<h2>Gone</h2>')
    } finally {
      if (existsSync(worktree)) {
        execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: REPO })
      }
      rmSync(parent, { recursive: true, force: true })
    }
  })

  test("scenes:diff of a ref that isn't there exits 1 and leaves nothing behind", {
    timeout: 300_000,
  }, () => {
    const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: REPO,
      encoding: 'utf8',
    })
    const before = leftovers()
    const result = spawnSync('bun', ['run', 'scenes:diff', 'no-such-ref'], {
      cwd: DESKTOP,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      timeout: 300_000,
    })
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('no-such-ref')
    expect(
      execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO, encoding: 'utf8' }),
    ).toBe(worktrees)
    expect(leftovers()).toEqual(before)
  })

  test('a scene shot twice on one machine differs in no pixel', { timeout: 120_000 }, async () => {
    const browser = await launch()
    if (browser === null) throw new Error('no browser to shoot with')
    const server = await serve(SCENES_OUT)
    const parent = mkdtempSync(join(tmpdir(), 'have-fish-twice-'))
    try {
      const page = await browser.newPage()
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.emulateMedia({ colorScheme: 'light' })
      const shot = async (file: string) => {
        await page.goto(`${server.url}/?scene=ledger/year`)
        await page.waitForSelector('body[data-scene=ready]')
        await page.screenshot({ path: join(parent, file), animations: 'disabled' })
      }
      await shot('first.png')
      await shot('second.png')
      expect(
        pixelsDifferent(
          join(parent, 'first.png'),
          join(parent, 'second.png'),
          join(parent, 'difference.png'),
        ),
      ).toBe(0)
    } finally {
      await browser.close()
      await server.close()
      rmSync(parent, { recursive: true, force: true })
    }
  })

  test('without compare it says so, and shows before and after with no difference', {
    timeout: 900_000,
  }, () => {
    // A path with what a build needs and no `compare`: the diff says what it can't tell.
    const parent = mkdtempSync(join(tmpdir(), 'have-fish-nocompare-'))
    const bin = join(parent, 'bin')
    mkdirSync(bin)
    try {
      for (const tool of ['bun', 'node', 'git', 'sh', 'bash', 'unzip', 'tar']) {
        const found = spawnSync('which', [tool], { encoding: 'utf8' }).stdout?.trim()
        if (found) symlinkSync(found, join(bin, tool))
      }
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' })
      const result = spawnSync('bun', ['run', 'scenes:diff', base.trim()], {
        cwd: DESKTOP,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
        timeout: 600_000,
        env: { ...process.env, PATH: bin },
      })
      expect(result.stdout).toContain('no ImageMagick compare')
      expect(result.status).toBe(0)

      const page = readFileSync(join(DIFF, 'index.html'), 'utf8')
      expect(page).toContain('No compare on this machine')
      const sources = sourcesOf(page)
      expect(sources.filter((src) => src.startsWith('diff/'))).toEqual([])
      expect(sources.filter((src) => src.startsWith('base/'))).toHaveLength(FILES.length)
      expect(sources.filter((src) => src.startsWith('branch/'))).toHaveLength(FILES.length)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
