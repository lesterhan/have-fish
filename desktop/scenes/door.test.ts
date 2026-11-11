// The scenes are for design work and the e2e suite only: built outside out/, which is all a
// package ships, and loadable only by their own entry, never through the app's window.

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { SCENES_OUT } from '../vite.scenes.config'

const DESKTOP = join(import.meta.dirname, '..')
const read = (file: string) => readFileSync(join(DESKTOP, file), 'utf8')

const filesUnder = (dir: string): string[] =>
  existsSync(join(DESKTOP, dir))
    ? readdirSync(join(DESKTOP, dir), { recursive: true, encoding: 'utf8' }).map((f) =>
        join(dir, f),
      )
    : []

describe('the scenes stay out of the app', () => {
  test('they build to scenes-out/, beside out/ and not in it', () => {
    expect(relative(DESKTOP, SCENES_OUT)).toBe('scenes-out')
  })

  test('the package ships out/ and nothing of the scenes', () => {
    const builder = read('electron-builder.yml')
    expect(builder).toMatch(/^ {2}- out\/\*\*$/m)
    expect(builder).not.toMatch(/scene/)
  })

  test("the app's build has only its own page as input", () => {
    const config = read('electron.vite.config.ts')
    expect(config).toContain("root: 'renderer'")
    expect(config).not.toMatch(/scene/)
  })

  test("no built file of the app is a scene's", () => {
    // After `bun run build`; with no out/, there is nothing to ship either.
    expect(filesUnder('out').filter((f) => /scene/i.test(f))).toEqual([])
  })

  test('nothing the app runs names the scenes', () => {
    const app = ['main', 'preload', 'renderer', 'shared'].flatMap(filesUnder)
    const naming = app.filter(
      (f) => /\.(ts|svelte|html|css)$/.test(f) && /scenes-out|\/scenes\//.test(read(f)),
    )
    expect(naming).toEqual([])
  })

  test('the fixtures are recorded, never committed', () => {
    expect(read('.gitignore')).toContain('scenes/fixtures/')
    const tracked = execSync('git ls-files -- scenes/fixtures', { cwd: DESKTOP, encoding: 'utf8' })
    expect(tracked).toBe('')
  })
})
