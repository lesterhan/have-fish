import { describe, expect, test } from 'vitest'
import { type BalanceRow, balanceRows, type Held } from './balances'

const held = (id: string, path: string, totals: Record<string, number> = {}): Held => ({
  id,
  path,
  totals: Object.entries(totals).map(([currency, cents]) => ({ currency, cents })),
})

/** A row as a short line: indent, label, id or `-` for one nobody added, then each total. */
const line = (r: BalanceRow) =>
  `${'  '.repeat(r.depth)}${r.label} ${r.id ?? '-'} ${r.totals.map((t) => `${t.cents} ${t.currency}`).join(', ')}`.trimEnd()

describe('balanceRows', () => {
  test('nothing held, no rows', () => {
    expect(balanceRows([])).toEqual([])
  })

  test('each account its own row, by name without regard to case, whatever its root', () => {
    const rows = balanceRows([
      held('v', 'liabilities:Visa', { CAD: -5000 }),
      held('c', 'assets:cash', { CAD: 1200 }),
      held('b', 'assets:bank'),
    ])

    expect(rows.map(line)).toEqual(['bank b', 'cash c 1200 CAD', 'Visa v -5000 CAD'])
    expect(rows.map((r) => r.root)).toEqual(['assets', 'assets', 'liabilities'])
    expect(rows.map((r) => r.path)).toEqual(['assets:bank', 'assets:cash', 'liabilities:Visa'])
  })

  test('a parent sums its children per currency, under a row nobody added', () => {
    const rows = balanceRows([
      held('e', 'assets:wise:eur', { EUR: 5000 }),
      held('c', 'assets:wise:cad', { CAD: 10000 }),
    ])

    expect(rows.map(line)).toEqual([
      'wise - 10000 CAD, 5000 EUR',
      '  cad c 10000 CAD',
      '  eur e 5000 EUR',
    ])
  })

  test('a parent I added has its own money as well as its children’s', () => {
    const rows = balanceRows([
      held('c', 'assets:wise:cad', { CAD: 10000 }),
      held('w', 'assets:wise', { CAD: 250, USD: 100 }),
    ])

    expect(rows.map(line)).toEqual(['wise w 10250 CAD, 100 USD', '  cad c 10000 CAD'])
  })

  test('nests as deep as the names do, each level rolled up', () => {
    const rows = balanceRows([
      held('a', 'assets:bank:td:chequing', { CAD: 300 }),
      held('b', 'assets:bank:td:savings', { CAD: 700 }),
      held('c', 'assets:bank:rbc', { CAD: 1 }),
    ])

    expect(rows.map(line)).toEqual([
      'bank - 1001 CAD',
      '  rbc c 1 CAD',
      '  td - 1000 CAD',
      '    chequing a 300 CAD',
      '    savings b 700 CAD',
    ])
  })

  test('what cancels out is left out; an account at zero still has its row', () => {
    const rows = balanceRows([
      held('a', 'assets:wise:cad', { CAD: 500 }),
      held('b', 'assets:wise:usd', { CAD: -500, USD: 0 }),
    ])

    expect(rows.map(line)).toEqual(['wise -', '  cad a 500 CAD', '  usd b -500 CAD'])
  })

  test('the same name under two roots is two trees: what I have never nets against what I owe', () => {
    const rows = balanceRows([
      held('a', 'assets:amex:cash', { CAD: 100 }),
      held('b', 'liabilities:amex:card', { CAD: -900 }),
    ])

    expect(rows.map(line)).toEqual([
      'amex - 100 CAD',
      '  cash a 100 CAD',
      'amex - -900 CAD',
      '  card b -900 CAD',
    ])
    expect(rows.map((r) => r.root)).toEqual(['assets', 'assets', 'liabilities', 'liabilities'])
  })

  test('totals are in currency order', () => {
    const [row] = balanceRows([held('a', 'assets:cash', { USD: 1, CAD: 2, EUR: 3 })])
    expect(row?.totals.map((t) => t.currency)).toEqual(['CAD', 'EUR', 'USD'])
  })
})
