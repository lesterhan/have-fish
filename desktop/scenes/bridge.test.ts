import { addDays } from '@have-fish/core/calendar-date'
import { describe, expect, test } from 'vitest'
import type { ListedAccount, ListedPath, ListedTransaction, Wire } from '../shared/commands'
import { type Replay, replayBridge } from './bridge'
import { EMPTY, type Fixture, SCENE_TODAY } from './fixture'

// The fixture the bridge is tested over, written here rather than recorded: 250 rows on ten
// days (the page examples slice it), three accounts, and two recorded weeks.

const aRow = (at: number): ListedTransaction => ({
  id: `row-${at}`,
  date: addDays(SCENE_TODAY, -Math.floor(at / 25)),
  description: `spend ${at}`,
  amounts: [{ amount: '1.00', currency: 'CAD' }],
  simple: { amount: '1.00', currency: 'CAD' },
  from: 'chequing',
  to: 'food',
  fromPath: 'assets:chequing',
  toPath: 'expenses:food',
  legs: [
    { amount: '-1.00', currency: 'CAD', path: 'assets:chequing' },
    { amount: '1.00', currency: 'CAD', path: 'expenses:food' },
  ],
  origin: { source: 'manual', at, here: true, file: null, line: null },
})

function aFixture(): Fixture {
  const rows = Array.from({ length: 250 }, (_, at) => aRow(at))
  const days = Array.from({ length: 10 }, (_, day) => ({
    date: addDays(SCENE_TODAY, -day),
    count: 25,
  }))
  const accounts: ListedAccount[] = [
    {
      id: 'acc-chequing',
      name: 'chequing',
      kind: 'bank',
      currency: 'CAD',
      start: null,
      balance: [{ amount: '100.00', currency: 'CAD' }],
    },
    {
      id: 'acc-visa',
      name: 'visa',
      kind: 'card',
      currency: 'CAD',
      start: null,
      balance: [{ amount: '-40.00', currency: 'CAD' }],
    },
    {
      id: 'acc-wallet',
      name: 'wallet',
      kind: 'cash',
      currency: null,
      start: null,
      balance: [],
    },
  ]
  const paths: ListedPath[] = [
    { id: 'acc-chequing', path: 'assets:chequing', kind: 'bank', lastUsed: null },
    { id: 'cat-food', path: 'expenses:food', kind: 'category', lastUsed: null },
    { id: 'src-salary', path: 'income:salary', kind: 'income', lastUsed: null },
  ]
  return {
    profile: 'test',
    seed: '1',
    today: SCENE_TODAY,
    currency: 'CAD',
    rows,
    days,
    nets: days.map(({ date }) => ({ date, net: [{ amount: '-25.00', currency: 'CAD' }] })),
    accounts,
    paths,
    assumedFrom: 'acc-chequing',
    reports: {
      '2026-11-03': {
        currency: 'CAD',
        spent: [{ id: 'row-0', category: 'food', amount: '1.00' }],
        other: [],
      },
      '2026-10-27': { currency: 'CAD', spent: [], other: [] },
    },
  }
}

/** invoke without the types, as the page at runtime could send anything. */
const wire = (bridge: Replay) =>
  bridge.invoke as (name: string, input: unknown) => Promise<Wire<unknown>>

describe('transaction.page', () => {
  test('a page of the list, with the nets of the days it falls on and no other', async () => {
    const fixture = aFixture()
    const bridge = replayBridge(fixture)
    const page = await bridge.invoke('transaction.page', { from: 0, limit: 100 })
    expect(page).toEqual({
      ok: true,
      value: {
        total: 250,
        from: 0,
        rows: fixture.rows.slice(0, 100),
        nets: fixture.nets.slice(0, 4),
      },
    })
  })

  test('the last page is short, and one past the end is empty', async () => {
    const fixture = aFixture()
    const bridge = replayBridge(fixture)
    const last = await bridge.invoke('transaction.page', { from: 200, limit: 100 })
    expect(last).toEqual({
      ok: true,
      value: { total: 250, from: 200, rows: fixture.rows.slice(200), nets: fixture.nets.slice(8) },
    })
    const past = await bridge.invoke('transaction.page', { from: 300, limit: 100 })
    expect(past).toEqual({ ok: true, value: { total: 250, from: 300, rows: [], nets: [] } })
  })
})

describe('transaction.position', () => {
  test('where a row sits, and null for one that is not there', async () => {
    const bridge = replayBridge(aFixture())
    await expect(bridge.invoke('transaction.position', { id: 'row-7' })).resolves.toEqual({
      ok: true,
      value: { at: 7 },
    })
    await expect(bridge.invoke('transaction.position', { id: 'row-999' })).resolves.toEqual({
      ok: true,
      value: { at: null },
    })
  })
})

describe('transaction.get', () => {
  test("the live ones in the list's order, and nothing for a stranger", async () => {
    const fixture = aFixture()
    const bridge = replayBridge(fixture)
    const got = await bridge.invoke('transaction.get', {
      ids: ['row-5', 'row-2', 'row-999'],
    })
    expect(got).toEqual({ ok: true, value: [fixture.rows[2], fixture.rows[5]] })
  })
})

describe('the plain reads', () => {
  test('days, accounts, paths, assumedFrom and undo steps come straight from the fixture', async () => {
    const fixture = aFixture()
    const bridge = replayBridge(fixture)
    await expect(bridge.invoke('transaction.days', {})).resolves.toEqual({
      ok: true,
      value: fixture.days,
    })
    await expect(bridge.invoke('account.list', {})).resolves.toEqual({
      ok: true,
      value: fixture.accounts,
    })
    await expect(bridge.invoke('path.list', {})).resolves.toEqual({
      ok: true,
      value: fixture.paths,
    })
    await expect(bridge.invoke('spend.assumedFrom', {})).resolves.toEqual({
      ok: true,
      value: { id: 'acc-chequing' },
    })
    await expect(bridge.invoke('ledger.steps', {})).resolves.toEqual({
      ok: true,
      value: { undo: null, redo: null },
    })
  })
})

describe('report.spending', () => {
  test('a recorded week answers its report; one not recorded, an empty one', async () => {
    const fixture = aFixture()
    const bridge = replayBridge(fixture)
    await expect(
      bridge.invoke('report.spending', { start: '2026-11-03', end: '2026-11-09' }),
    ).resolves.toEqual({ ok: true, value: fixture.reports['2026-11-03'] })
    await expect(
      bridge.invoke('report.spending', { start: '2026-10-20', end: '2026-10-26' }),
    ).resolves.toEqual({ ok: true, value: { currency: 'CAD', spent: [], other: [] } })
  })
})

describe('settings and the clipboard', () => {
  test('density is regular unless the scene says otherwise, and set changes it', async () => {
    const plain = replayBridge(aFixture())
    await expect(plain.invoke('settings.density.get', {})).resolves.toEqual({
      ok: true,
      value: { density: 'regular' },
    })
    const compact = replayBridge(aFixture(), { density: 'compact' })
    await expect(compact.invoke('settings.density.get', {})).resolves.toEqual({
      ok: true,
      value: { density: 'compact' },
    })
    await compact.invoke('settings.density.set', { density: 'large' })
    await expect(compact.invoke('settings.density.get', {})).resolves.toEqual({
      ok: true,
      value: { density: 'large' },
    })
  })

  test('theme.set answers with the theme, clipboard.copy with null', async () => {
    const bridge = replayBridge(aFixture())
    await expect(bridge.invoke('settings.theme.set', { theme: 'graphite-dark' })).resolves.toEqual({
      ok: true,
      value: { theme: 'graphite-dark' },
    })
    await expect(bridge.invoke('clipboard.copy', { text: 'x' })).resolves.toEqual({
      ok: true,
      value: null,
    })
  })
})

describe('writes', () => {
  const WRITES = [
    'spend.write',
    'spend.edit',
    'spend.remove',
    'account.add',
    'account.start',
    'ledger.undo',
    'ledger.redo',
  ] as const

  test.each(WRITES)('%s is refused as unknown, and the fixture is as it was', async (name) => {
    const fixture = aFixture()
    const before = structuredClone(fixture)
    const result = await wire(replayBridge(fixture))(name, {})
    expect(result).toEqual({ ok: false, error: 'COMMAND_UNKNOWN', detail: { name } })
    expect(fixture).toEqual(before)
  })

  test('a name that is no command gets the same refusal, naming it', async () => {
    const result = await wire(replayBridge(aFixture()))('spend.frobnicate', {})
    expect(result).toEqual({
      ok: false,
      error: 'COMMAND_UNKNOWN',
      detail: { name: 'spend.frobnicate' },
    })
  })
})

describe('the listeners', () => {
  test('onChanged is never called, whatever is invoked, and returns an unsubscribe', async () => {
    const bridge = replayBridge(aFixture())
    let calls = 0
    const off = bridge.onChanged(() => {
      calls += 1
    })
    await bridge.invoke('transaction.page', { from: 0, limit: 100 })
    await wire(bridge)('spend.write', {})
    expect(calls).toBe(0)
    expect(typeof off).toBe('function')
    off()
  })

  test('act sends the action to each onAction listener, less the unsubscribed', () => {
    const bridge = replayBridge(aFixture())
    const got: string[] = []
    const off = bridge.onAction((id) => got.push(`first:${id}`))
    bridge.onAction((id) => got.push(`second:${id}`))
    off()
    bridge.act('showReports')
    expect(got).toEqual(['second:showReports'])
  })

  test('setTyping is accepted and does nothing', () => {
    const bridge = replayBridge(aFixture())
    expect(() => bridge.setTyping({ undo: true, redo: false })).not.toThrow()
  })
})

describe('EMPTY', () => {
  test('a bridge over it holds nothing', async () => {
    const bridge = replayBridge(EMPTY)
    await expect(bridge.invoke('transaction.page', { from: 0, limit: 100 })).resolves.toEqual({
      ok: true,
      value: { total: 0, from: 0, rows: [], nets: [] },
    })
    await expect(bridge.invoke('transaction.days', {})).resolves.toEqual({
      ok: true,
      value: [],
    })
    await expect(bridge.invoke('account.list', {})).resolves.toEqual({
      ok: true,
      value: [],
    })
    await expect(bridge.invoke('spend.assumedFrom', {})).resolves.toEqual({
      ok: true,
      value: { id: null },
    })
  })
})
