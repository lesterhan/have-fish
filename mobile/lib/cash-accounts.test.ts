import { describe, it, expect } from 'bun:test'
import {
  balanceIn,
  cashAccounts,
  formatAmount,
  isCashAccount,
  resolveActiveWalletId,
  takenCurrencies,
  walletCurrency,
  walletLabel,
  walletViews,
} from './cash-accounts'
import type { AccountBalance } from './api'

function bal(
  path: string,
  opts: Partial<AccountBalance> = {},
): AccountBalance {
  return {
    id: opts.id ?? path,
    path,
    name: opts.name ?? null,
    type: opts.type ?? 'asset',
    resolvedType: opts.resolvedType ?? 'asset',
    defaultCurrency: opts.defaultCurrency ?? null,
    balances: opts.balances ?? [],
  }
}

function wallet(path: string, opts: Partial<AccountBalance> = {}): AccountBalance {
  return bal(path, { ...opts, resolvedType: 'cash' })
}

describe('isCashAccount', () => {
  it('accepts an account resolved as cash', () => {
    expect(isCashAccount({ resolvedType: 'cash' })).toBe(true)
  })

  it('rejects a cash-looking path with no tag', () => {
    // The strict rule: inference never yields 'cash', so an untagged
    // assets:cash:* account is an ordinary asset.
    expect(isCashAccount({ resolvedType: 'asset' })).toBe(false)
  })

  it('rejects an unclassified account', () => {
    expect(isCashAccount({ resolvedType: null })).toBe(false)
    expect(isCashAccount({})).toBe(false)
  })
})

describe('cashAccounts', () => {
  it('keeps only tagged wallets', () => {
    const list = [
      wallet('assets:cash:cad'),
      bal('assets:chequing'),
      bal('assets:cash:usd'), // path looks the part, not tagged
      wallet('assets:cash:cny'),
    ]
    expect(cashAccounts(list).map((a) => a.path)).toEqual([
      'assets:cash:cad',
      'assets:cash:cny',
    ])
  })

  it('orders by path so per-currency siblings group and the order is stable', () => {
    const list = [wallet('assets:cash:jpy'), wallet('assets:cash:cad'), wallet('储蓄:现金')]
    const once = cashAccounts(list).map((a) => a.path)
    const twice = cashAccounts([...list].reverse()).map((a) => a.path)
    expect(once).toEqual(twice)
    expect(once.slice(0, 2)).toEqual(['assets:cash:cad', 'assets:cash:jpy'])
  })

  it('returns an empty list when nothing is tagged', () => {
    expect(cashAccounts([bal('assets:chequing'), bal('expenses:food')])).toEqual([])
  })
})

describe('walletLabel', () => {
  it('prefers the display name', () => {
    expect(walletLabel({ name: 'Pocket money', path: 'assets:cash:cad' })).toBe('Pocket money')
  })

  it('upper-cases a currency-code leaf', () => {
    expect(walletLabel({ path: 'assets:cash:cny' })).toBe('CNY')
  })

  it('leaves a non-currency leaf as written', () => {
    expect(walletLabel({ path: 'assets:cash:travel-fund' })).toBe('travel-fund')
  })

  it('ignores a blank name', () => {
    expect(walletLabel({ name: '   ', path: 'assets:cash:cad' })).toBe('CAD')
  })

  it('handles a rootless path', () => {
    expect(walletLabel({ path: 'wallet' })).toBe('wallet')
  })
})

describe('walletCurrency', () => {
  it('prefers the account default currency', () => {
    expect(walletCurrency({ defaultCurrency: 'CNY', path: 'assets:cash:cad' })).toBe('CNY')
  })

  it('falls back to a three-letter leaf', () => {
    expect(walletCurrency({ path: 'assets:cash:jpy' })).toBe('JPY')
  })

  it('normalises case from either source', () => {
    expect(walletCurrency({ defaultCurrency: 'cad', path: 'x' })).toBe('CAD')
    expect(walletCurrency({ path: 'assets:cash:Gbp' })).toBe('GBP')
  })

  it('returns null when neither source can say', () => {
    expect(walletCurrency({ path: 'assets:cash:wallet' })).toBeNull()
    expect(walletCurrency({ defaultCurrency: '  ', path: '储蓄:现金' })).toBeNull()
  })
})

describe('balanceIn', () => {
  it('finds the matching currency', () => {
    const rows = [
      { currency: 'CAD', amount: '260.00' },
      { currency: 'CNY', amount: '540.00' },
    ]
    expect(balanceIn(rows, 'CNY')).toBe('540.00')
  })

  it('reports zero for a currency with no postings', () => {
    expect(balanceIn([], 'CAD')).toBe('0.00')
  })
})

describe('formatAmount', () => {
  it('formats a positive amount with separators', () => {
    expect(formatAmount('1260.50')).toBe('1,260.50')
  })

  it('uses a real minus sign for a negative balance', () => {
    // A negative wallet means an unrecorded top-up — surface it, don't clamp it.
    expect(formatAmount('-40.00')).toBe('−40.00')
  })

  it('formats zero without a sign', () => {
    expect(formatAmount('0.00')).toBe('0.00')
  })

  it('passes through a value it cannot parse', () => {
    expect(formatAmount('not-a-number')).toBe('not-a-number')
  })
})

describe('walletViews', () => {
  it('joins a wallet to the balance in its own currency', () => {
    const views = walletViews([
      wallet('assets:cash:cad', {
        id: 'w1',
        defaultCurrency: 'CAD',
        balances: [{ currency: 'CAD', amount: '260.00' }],
      }),
    ])
    expect(views).toEqual([
      {
        id: 'w1',
        path: 'assets:cash:cad',
        label: 'CAD',
        currency: 'CAD',
        amount: '260.00',
        extra: [],
      },
    ])
  })

  it('shows a freshly created wallet at zero rather than hiding it', () => {
    const views = walletViews([wallet('assets:cash:jpy', { id: 'w2', defaultCurrency: 'JPY' })])
    expect(views[0].amount).toBe('0.00')
  })

  it('surfaces currencies beyond the wallet own as extra', () => {
    // One-wallet-per-currency is the rule, but a wallet that already holds two
    // must not silently hide the second — that would lose money on screen.
    const views = walletViews([
      wallet('assets:cash:cad', {
        defaultCurrency: 'CAD',
        balances: [
          { currency: 'CAD', amount: '100.00' },
          { currency: 'USD', amount: '20.00' },
        ],
      }),
    ])
    expect(views[0].amount).toBe('100.00')
    expect(views[0].extra).toEqual([{ currency: 'USD', amount: '20.00' }])
  })

  it('falls back to the first balance when the currency is unknowable', () => {
    const views = walletViews([
      wallet('储蓄:现金', { balances: [{ currency: 'CNY', amount: '80.00' }] }),
    ])
    expect(views[0].currency).toBeNull()
    expect(views[0].amount).toBe('80.00')
    expect(views[0].extra).toEqual([])
  })

  it('ignores untagged accounts', () => {
    expect(walletViews([bal('assets:chequing', { balances: [{ currency: 'CAD', amount: '9.00' }] })]))
      .toEqual([])
  })
})

describe('resolveActiveWalletId', () => {
  const wallets = [{ id: 'w1' }, { id: 'w2' }]

  it('keeps a stored id that still exists', () => {
    expect(resolveActiveWalletId('w2', wallets)).toBe('w2')
  })

  it('falls back to the first wallet when the stored id is gone', () => {
    // Deleted wallet, or a different login — must not leave the tab blank.
    expect(resolveActiveWalletId('deleted', wallets)).toBe('w1')
  })

  it('falls back to the first wallet when nothing is stored', () => {
    expect(resolveActiveWalletId(null, wallets)).toBe('w1')
    expect(resolveActiveWalletId(undefined, wallets)).toBe('w1')
  })

  it('returns null when there are no wallets', () => {
    expect(resolveActiveWalletId('w1', [])).toBeNull()
  })
})

describe('takenCurrencies', () => {
  it('lists the currencies that already have a wallet', () => {
    const taken = takenCurrencies([
      wallet('assets:cash:cad', { defaultCurrency: 'CAD' }),
      wallet('assets:cash:cny'),
      bal('assets:chequing', { defaultCurrency: 'USD' }),
    ])
    expect([...taken].sort()).toEqual(['CAD', 'CNY'])
  })

  it('ignores a wallet whose currency cannot be determined', () => {
    expect(takenCurrencies([wallet('储蓄:现金')]).size).toBe(0)
  })

  it('is empty for a ledger with no wallets', () => {
    expect(takenCurrencies([bal('assets:chequing')]).size).toBe(0)
  })
})
