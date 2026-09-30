import { describe, expect, it } from 'bun:test'
import type { Migration } from '../db/sqlite/migrate'
import { binaryEntrySource } from './embed'

const files = [
  { servedAs: '/index.html', source: '../../frontend/build/index.html' },
  {
    servedAs: '/_app/immutable/entry/app.Ab1-_c.js',
    source: '../../frontend/build/_app/immutable/entry/app.Ab1-_c.js',
  },
]
const migrations: Migration[] = [
  { tag: '0000_init', when: 1, statements: ["CREATE TABLE `a` (`x` text DEFAULT 'it''s')"] },
]
const launcher = '../src/local/launch'
const version = '1.2.3-rc.1'

describe('binaryEntrySource', () => {
  const source = binaryEntrySource(files, migrations, launcher, version)

  it('imports every file by name, as a file, and the launcher', () => {
    const imports = new Bun.Transpiler({ loader: 'ts' }).scan(source).imports.map((i) => i.path)
    expect(imports).toEqual([launcher, ...files.map((f) => f.source)])
    expect(source.match(/with \{ type: 'file' \}/g)?.length).toBe(files.length)
  })

  it('maps each served path to its import, and carries the migrations intact', () => {
    expect(source).toContain('["/index.html", f0],')
    expect(source).toContain('["/_app/immutable/entry/app.Ab1-_c.js", f1],')
    const carried = source.match(/const migrations = ([\s\S]*?)\n\n/)?.[1] ?? ''
    expect(JSON.parse(carried)).toEqual(migrations)
  })

  it('hands the launcher its own path, for the desktop entry (#338)', () => {
    expect(source).toContain('executable: process.execPath')
  })

  it('answers --version with the stamped version, before it launches anything', () => {
    expect(source).toContain(`process.stdout.write("havefish ${version}\\n")`)
    const check = source.indexOf("includes('--version')")
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(source.indexOf('await launchLocal('))
  })

  it('refuses a build with no document to serve', () => {
    expect(() => binaryEntrySource(files.slice(1), migrations, launcher, version)).toThrow(
      'index.html',
    )
  })

  it('refuses a name the bundler would read as something else', () => {
    for (const source of ['../build/a.js?raw', '../build/a#b.js', '/abs/a.js', 'bare/a.js']) {
      const odd = [...files, { servedAs: '/a.js', source }]
      expect(() => binaryEntrySource(odd, migrations, launcher, version)).toThrow('cannot embed')
    }
  })
})
