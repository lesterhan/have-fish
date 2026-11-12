import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type CommandName, inputs } from '../../shared/commands'

/** The commands main may hold that the window never invokes. */
const MAINS_OWN: readonly CommandName[] = []

const RENDERER = fileURLToPath(new URL('../../renderer', import.meta.url))

/** The window's code, by path from `renderer/`, its tests left out. */
const SOURCES = new Map(
  readdirSync(RENDERER, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => /\.(ts|svelte)$/.test(file) && !file.endsWith('.test.ts'))
    .map((file) => [file, readFileSync(join(RENDERER, file), 'utf8')]),
)

/** Each name no source invokes by its whole name, less `mains`, in `names`' order. */
function uncalled(
  names: readonly string[],
  sources: readonly string[],
  mains: readonly string[],
): string[] {
  return names.filter((name) => {
    if (mains.includes(name)) return false
    const call = new RegExp(`invoke\\(\\s*(['"\`])${name.replaceAll('.', '\\.')}\\1`)
    return !sources.some((source) => call.test(source))
  })
}

describe('uncalled', () => {
  it('finds a call', () => {
    expect(uncalled(['spend.write'], ["bridge.invoke('spend.write', values)"], [])).toEqual([])
  })

  it('counts a mention as no call', () => {
    expect(uncalled(['spend.write'], ["const name = 'spend.write'"], [])).toEqual(['spend.write'])
  })

  it('does not read a template', () => {
    expect(uncalled(['ledger.undo'], ['invoke(`ledger.${way}`, {})'], [])).toEqual(['ledger.undo'])
  })

  it('finds a call across lines', () => {
    expect(uncalled(['report.spending'], ["invoke(\n  'report.spending', {"], [])).toEqual([])
  })

  it('matches the whole name, not a prefix', () => {
    expect(uncalled(['spend.write', 'spend.writes'], ["invoke('spend.writes', {})"], [])).toEqual([
      'spend.write',
    ])
  })

  it("leaves out main's own", () => {
    expect(uncalled(['spend.write'], [], ['spend.write'])).toEqual([])
  })
})

describe('every command', () => {
  it('has a caller in the window', () => {
    expect(uncalled(Object.keys(inputs), [...SOURCES.values()], MAINS_OWN)).toEqual([])
  })

  it('is looked for in the files that invoke them', () => {
    expect([...SOURCES.keys()]).toEqual(expect.arrayContaining(['App.svelte', 'ledger.ts']))
  })
})
