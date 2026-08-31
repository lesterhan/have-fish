import { describe, it, expect } from 'bun:test'
import {
  ROLE_LABEL,
  isSystemManaged,
  protectionFor,
  protectionMessage,
  rolesOf,
} from './accountRoles'
import type { Roots } from './accountPaths'
import type { UserSettings } from '../../api'

const ROOTS: Roots = {
  assets: 'assets',
  liabilities: 'liabilities',
  equity: 'equity',
  expenses: 'expenses',
  income: 'income',
}

function settings(over: Partial<UserSettings> = {}): UserSettings {
  return {
    defaultOffsetAccountId: null,
    defaultConversionAccountId: null,
    defaultAdjustmentsAccountId: null,
    ...over,
  } as UserSettings
}

describe('rolesOf', () => {
  it('names the role an account fills', () => {
    expect(rolesOf('a', settings({ defaultOffsetAccountId: 'a' }))).toEqual(['offset'])
    expect(rolesOf('a', settings({ defaultConversionAccountId: 'a' }))).toEqual([
      'conversion',
    ])
    expect(rolesOf('a', settings({ defaultAdjustmentsAccountId: 'a' }))).toEqual([
      'adjustments',
    ])
  })

  it('names every role when one account fills several', () => {
    expect(
      rolesOf(
        'a',
        settings({ defaultOffsetAccountId: 'a', defaultAdjustmentsAccountId: 'a' }),
      ),
    ).toEqual(['offset', 'adjustments'])
  })

  it('is empty for an account nothing points at', () => {
    expect(rolesOf('b', settings({ defaultOffsetAccountId: 'a' }))).toEqual([])
  })

  it('is empty before settings have loaded, rather than throwing', () => {
    expect(rolesOf('a', null)).toEqual([])
    expect(rolesOf('a', undefined)).toEqual([])
  })

  it('does not treat an unset pointer as pointing at every account', () => {
    // Guards against `settings.defaultOffsetAccountId === accountId` matching null == null.
    expect(rolesOf('', settings())).toEqual([])
  })
})

describe('isSystemManaged', () => {
  it('covers the receivable subtree', () => {
    expect(isSystemManaged('assets:receivable:alice', ROOTS)).toBe(true)
    expect(isSystemManaged('assets:receivable', ROOTS)).toBe(true)
  })

  it('leaves ordinary asset accounts alone', () => {
    expect(isSystemManaged('assets:chequing', ROOTS)).toBe(false)
    // Anchored on the separator, so a sibling with a shared prefix is not swept in.
    expect(isSystemManaged('assets:receivables:old', ROOTS)).toBe(false)
  })

  it('follows a renamed assets root', () => {
    const custom: Roots = { ...ROOTS, assets: 'activos' }
    expect(isSystemManaged('activos:receivable:alice', custom)).toBe(true)
    expect(isSystemManaged('assets:receivable:alice', custom)).toBe(false)
  })
})

describe('protectionFor', () => {
  const plain = { id: 'a', path: 'assets:chequing' }

  it('is null for an account that is free to hide', () => {
    expect(protectionFor(plain, settings(), ROOTS)).toBeNull()
  })

  it('reports the roles pointing at it', () => {
    expect(
      protectionFor(plain, settings({ defaultOffsetAccountId: 'a' }), ROOTS),
    ).toEqual({ kind: 'role', roles: ['offset'] })
  })

  it('reports a receivable as system-managed', () => {
    expect(
      protectionFor({ id: 'r', path: 'assets:receivable:alice' }, settings(), ROOTS),
    ).toEqual({ kind: 'system' })
  })

  it('leads with the role when an account is both', () => {
    // The role is the actionable one — you can re-point a setting, you cannot un-manage
    // a receivable — so it is the reason worth showing.
    expect(
      protectionFor(
        { id: 'r', path: 'assets:receivable:alice' },
        settings({ defaultOffsetAccountId: 'r' }),
        ROOTS,
      ),
    ).toEqual({ kind: 'role', roles: ['offset'] })
  })
})

describe('protectionMessage', () => {
  it('names the setting to re-point', () => {
    expect(protectionMessage({ kind: 'role', roles: ['offset'] })).toBe(
      'Point OFFSET at another account in Settings first — this is in use.',
    )
  })

  it('agrees in number when several roles point at one account', () => {
    expect(
      protectionMessage({ kind: 'role', roles: ['offset', 'conversion'] }),
    ).toBe(
      'Point OFFSET, CONVERSION at another account in Settings first — these are in use.',
    )
  })

  it('explains a system-managed account instead of naming a setting', () => {
    expect(protectionMessage({ kind: 'system' })).toBe(
      'Fish Pie manages this account — it is re-created on import.',
    )
  })

  it('has a label for every role', () => {
    expect(Object.values(ROLE_LABEL)).toEqual([
      'OFFSET',
      'CONVERSION',
      'ADJUSTMENTS',
    ])
  })
})
