// The parts sheet is for the capture script only: built outside out/, which is all a package
// ships, and loadable only by its own entry, never through the app's window.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { SHEET_OUT } from '../vite.sheet.config'

const DESKTOP = join(import.meta.dirname, '..')
const read = (file: string) => readFileSync(join(DESKTOP, file), 'utf8')

const filesUnder = (dir: string): string[] =>
  existsSync(join(DESKTOP, dir))
    ? readdirSync(join(DESKTOP, dir), { recursive: true, encoding: 'utf8' }).map((f) =>
        join(dir, f),
      )
    : []

describe('the parts sheet stays out of the app', () => {
  test('it builds to sheet-out/, beside out/ and not in it', () => {
    expect(relative(DESKTOP, SHEET_OUT)).toBe('sheet-out')
  })

  test('the package ships out/ and nothing of the sheet', () => {
    const builder = read('electron-builder.yml')
    expect(builder).toMatch(/^ {2}- out\/\*\*$/m)
    expect(builder).not.toMatch(/sheet/)
  })

  test('the app’s build has only its own page as input', () => {
    const config = read('electron.vite.config.ts')
    expect(config).toContain("root: 'renderer'")
    expect(config).not.toMatch(/sheet/)
  })

  test('no built file of the app is the sheet', () => {
    // After `bun run build`; with no out/, there is nothing to ship either.
    expect(filesUnder('out').filter((f) => /sheet/i.test(f))).toEqual([])
  })

  test('nothing the app runs names the sheet', () => {
    const app = ['main', 'preload', 'renderer', 'shared'].flatMap(filesUnder)
    const naming = app.filter(
      (f) => /\.(ts|svelte|html|css)$/.test(f) && /sheet-out|\/sheet\//.test(read(f)),
    )
    expect(naming).toEqual([])
  })
})
