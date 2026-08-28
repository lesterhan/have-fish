import { describe, it, expect } from 'bun:test'
import {
  CASH_PARENT,
  blockReasonFor,
  canCreateWallet,
  defaultWalletName,
  walletCreateFailure,
  walletCreateRequest,
  walletCreateSteps,
  walletPath,
} from './cash-wallet-create'

const none = new Set<string>()

describe('walletPath', () => {
  it('puts the wallet under the fixed cash parent, keyed by currency', () => {
    expect(walletPath('CAD')).toBe('assets:cash:cad')
    expect(walletPath('CNY')).toBe('assets:cash:cny')
  })

  it('lower-cases the leaf so it matches its siblings in the tree', () => {
    // Paths are case-sensitive strings in the ledger; a stray uppercase leaf
    // sorts and reads as a stranger next to the rest of the tree.
    expect(walletPath('jpy')).toBe('assets:cash:jpy')
    expect(walletPath('  GbP  ')).toBe('assets:cash:gbp')
  })

  it('builds on the exported parent so the preview and the request agree', () => {
    expect(walletPath('USD').startsWith(`${CASH_PARENT}:`)).toBe(true)
  })
})

describe('defaultWalletName', () => {
  it('names the wallet by its currency', () => {
    expect(defaultWalletName('CAD')).toBe('Cash (CAD)')
    expect(defaultWalletName('cny')).toBe('Cash (CNY)')
  })
})

describe('blockReasonFor', () => {
  it('allows a supported currency with no wallet yet', () => {
    expect(blockReasonFor('CAD', none)).toBeNull()
    expect(canCreateWallet('CAD', none)).toBe(true)
  })

  it('blocks a currency that already has a wallet', () => {
    // Blocked rather than hidden: the picker can then say why, instead of
    // silently lacking a tile the user is looking for.
    expect(blockReasonFor('CNY', new Set(['CNY']))).toBe('taken')
    expect(canCreateWallet('CNY', new Set(['CNY']))).toBe(false)
  })

  it('blocks a currency the app does not support', () => {
    expect(blockReasonFor('XYZ', none)).toBe('unsupported')
    expect(blockReasonFor('', none)).toBe('unsupported')
  })

  it('compares case- and whitespace-insensitively', () => {
    expect(blockReasonFor(' cad ', new Set(['CAD']))).toBe('taken')
  })

  it('reports unsupported ahead of taken', () => {
    // A taken set holding a code the app no longer supports shouldn't make it
    // look like a currency you merely already own.
    expect(blockReasonFor('XYZ', new Set(['XYZ']))).toBe('unsupported')
  })
})

describe('walletCreateRequest', () => {
  it('assembles the create body', () => {
    expect(walletCreateRequest('cny', none)).toEqual({
      path: 'assets:cash:cny',
      name: 'Cash (CNY)',
      defaultCurrency: 'CNY',
    })
  })

  it('sets defaultCurrency so the wallet knows its currency without the path', () => {
    // walletCurrency() prefers this field; relying on the leaf alone would break
    // for any wallet later renamed on the web.
    expect(walletCreateRequest('JPY', none).defaultCurrency).toBe('JPY')
  })

  it('refuses a duplicate rather than minting a second wallet', () => {
    expect(() => walletCreateRequest('CAD', new Set(['CAD']))).toThrow(/already exists/)
  })

  it('refuses an unsupported currency', () => {
    expect(() => walletCreateRequest('XYZ', none)).toThrow(/Unsupported/)
  })
})

describe('walletCreateFailure', () => {
  it('resumes at the tag when the account exists but is untagged', () => {
    // The account is real at this point; retrying the create would mint a
    // duplicate, so the retry has to pick up at the tag.
    const failure = walletCreateFailure('tag')
    expect(failure.resumeAt).toBe('tag')
    expect(failure.message).toMatch(/Retry/)
  })

  it('resumes at the create when nothing was written', () => {
    expect(walletCreateFailure('create').resumeAt).toBe('create')
  })

  it('creates before tagging', () => {
    expect(walletCreateSteps).toEqual(['create', 'tag'])
  })
})
