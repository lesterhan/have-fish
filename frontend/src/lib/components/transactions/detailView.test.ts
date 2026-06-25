import { describe, it, expect } from 'bun:test'
import {
  headerTag,
  chipLabel,
  chipTone,
  heroDisplay,
  branchAmount,
  orderedBranches,
  convertedNote,
  formatTxDate,
} from './detailView'
import { narrateTransaction } from './narration'
import type { Posting, PostingRole } from '$lib/api'

function p(
  accountPath: string,
  amount: string,
  currency: string,
  role: PostingRole,
  accountName: string | null = null,
): Posting {
  return {
    id: accountPath + ':' + amount,
    accountId: accountPath,
    accountPath,
    accountName,
    amount,
    currency,
    role,
  }
}

const directSpend = [
  p('assets:chequing', '-50.00', 'CAD', 'transfer'),
  p('expenses:food:cafe', '50.00', 'CAD', 'subject'),
]
const splitSpend = [
  p('liabilities:visa', '-30.00', 'CAD', 'transfer'),
  p('expenses:food', '20.00', 'CAD', 'subject'),
  p('assets:receivable:roommates', '10.00', 'CAD', 'share'),
]
const multiCcySpend = [
  p('expenses:food:coffee', '360.00', 'CZK', 'subject'),
  p('assets:usd', '-17.24', 'USD', 'transfer'),
  p('equity:conversions', '-360.00', 'CZK', 'conversion'),
  p('equity:conversions', '17.24', 'USD', 'conversion'),
]
const income = [
  p('assets:chequing', '2000.00', 'CAD', 'transfer'),
  p('income:salary', '-2000.00', 'CAD', 'subject'),
]
const refund = [
  p('assets:chequing', '10.00', 'CAD', 'transfer'),
  p('expenses:food:cafe', '-10.00', 'CAD', 'subject'),
]

const narrate = (ps: Posting[]) => narrateTransaction(ps)

describe('headerTag', () => {
  it('direct spend has no tag', () => {
    expect(headerTag(narrate(directSpend), null)).toBeNull()
  })

  it('multi-currency spend has no tag', () => {
    expect(headerTag(narrate(multiCcySpend), null)).toBeNull()
  })

  it('split → two-chip Fish Pie identity (category + group)', () => {
    expect(headerTag(narrate(splitSpend), 'Household')).toEqual({
      kind: 'fishpie',
      category: 'Food',
      group: 'Household',
    })
  })

  it('split falls back to Split for a missing group name', () => {
    expect(headerTag(narrate(splitSpend), null)).toEqual({
      kind: 'fishpie',
      category: 'Food',
      group: 'Split',
    })
  })

  it('income inflow tags Income', () => {
    expect(headerTag(narrate(income), null)).toEqual({ kind: 'simple', label: 'Income' })
  })

  it('expense-refund inflow tags Refund', () => {
    expect(headerTag(narrate(refund), null)).toEqual({ kind: 'simple', label: 'Refund' })
  })
})

describe('chipLabel', () => {
  it('maps every chip to plain wording', () => {
    expect(chipLabel('the-spend')).toBe('the spend')
    expect(chipLabel('your-share')).toBe('your share')
    expect(chipLabel('owes-you')).toBe('owes you')
    expect(chipLabel('you-owe')).toBe('you owe')
    expect(chipLabel('fx-fee')).toBe('FX fee')
    expect(chipLabel('deposit')).toBe('deposit')
  })
})

describe('chipTone', () => {
  it('owes-you is accent', () => {
    expect(chipTone('owes-you')).toBe('accent')
  })
  it('deposit is positive (green)', () => {
    expect(chipTone('deposit')).toBe('positive')
  })
  it('fx-fee is amber', () => {
    expect(chipTone('fx-fee')).toBe('amber')
  })
  it('the rest are neutral', () => {
    expect(chipTone('the-spend')).toBe('neutral')
    expect(chipTone('your-share')).toBe('neutral')
    expect(chipTone('you-owe')).toBe('neutral')
  })
})

describe('heroDisplay', () => {
  it('outflow: magnitude, no sign, not positive', () => {
    expect(heroDisplay(narrate(directSpend))).toEqual({
      label: 'Food · Cafe',
      path: 'expenses:food:cafe',
      amount: '50.00',
      currency: 'CAD',
      sign: '',
      positive: false,
    })
  })

  it('split: hero shows the full fronted bill, not just your share', () => {
    // share 150 fronted from a -500 source; the other 350 is owed by the group.
    const h = heroDisplay(narrate(splitSpend))
    expect(h?.label).toBe('Food')
    expect(h?.amount).toBe('30.00')
  })

  it('split: full bill falls back to share + owed when source is a different currency', () => {
    // No conversion legs (still archetype 'split'), but the source asset is in another
    // currency — sum the hero (your share, 20) + the owed branch (10) in the hero ccy = 30.
    const h = heroDisplay(
      narrate([
        p('assets:usd', '-22.00', 'USD', 'transfer'),
        p('expenses:food', '20.00', 'CAD', 'subject'),
        p('assets:receivable:roommates', '10.00', 'CAD', 'share'),
      ]),
    )
    expect(h?.amount).toBe('30.00')
    expect(h?.currency).toBe('CAD')
  })

  it('inflow: leading + and positive flag despite negative stored amount', () => {
    const h = heroDisplay(narrate(income))
    expect(h?.amount).toBe('2000.00')
    expect(h?.sign).toBe('+')
    expect(h?.positive).toBe(true)
  })

  it('hero amount tracks the transaction, not a literal', () => {
    const h = heroDisplay(
      narrate([
        p('assets:chequing', '-12.34', 'CAD', 'transfer'),
        p('expenses:food:cafe', '12.34', 'CAD', 'subject'),
      ]),
    )
    expect(h?.amount).toBe('12.34')
  })

  it('null when there is no subject leg', () => {
    const h = heroDisplay(
      narrate([
        p('assets:savings', '1000.00', 'CAD', 'transfer'),
        p('equity:opening-balances', '-1000.00', 'CAD', 'conversion'),
      ]),
    )
    expect(h).toBeNull()
  })
})

describe('orderedBranches', () => {
  it('split: your share before owes-you (meaning order, not posting order)', () => {
    // Fixture posts the receivable (share) before nothing reorders it at the model level;
    // the render orders your-share ahead of the owes-you relationship.
    const n = narrate(splitSpend)
    const chips = orderedBranches(n.branches).map((b) => b.chip)
    expect(chips).toEqual(['your-share', 'owes-you'])
  })

  it('multi-currency: the spend before the FX fee', () => {
    const n = narrate([
      p('expenses:food:cafe', '50.00', 'EUR', 'subject'),
      p('expenses:banking:fee', '0.05', 'EUR', 'fee'),
      p('assets:wise:cad', '-80.08', 'CAD', 'transfer'),
      p('equity:conversions', '-50.05', 'EUR', 'conversion'),
      p('equity:conversions', '80.08', 'CAD', 'conversion'),
    ])
    const chips = orderedBranches(n.branches).map((b) => b.chip)
    expect(chips).toEqual(['the-spend', 'fx-fee'])
  })

  it('is stable for branches of equal rank', () => {
    const n = narrate([
      p('assets:chequing', '-75.00', 'CAD', 'transfer'),
      p('expenses:food:groceries', '50.00', 'CAD', 'subject'),
      p('expenses:home:supplies', '25.00', 'CAD', 'subject'),
    ])
    // Both 'the-spend' (rank 0) — input order preserved.
    expect(orderedBranches(n.branches).map((b) => b.path)).toEqual([
      'expenses:food:groceries',
      'expenses:home:supplies',
    ])
  })
})

describe('branchAmount', () => {
  it('always shows magnitude at 2dp', () => {
    expect(branchAmount('-30.00')).toBe('30.00')
    expect(branchAmount('10')).toBe('10.00')
    expect(branchAmount('garbage')).toBe('0.00')
  })
})

describe('convertedNote', () => {
  it('multi-currency: paid amount @ rate', () => {
    expect(convertedNote(narrate(multiCcySpend))).toBe('17.24 USD @ 20.88 CZK/USD')
  })

  it('null on a same-currency spend', () => {
    expect(convertedNote(narrate(directSpend))).toBeNull()
  })
})

describe('formatTxDate', () => {
  it('formats a stored date as weekday, month day, year (no tz shift)', () => {
    expect(formatTxDate('2026-06-24')).toBe('Wed, Jun 24, 2026')
    expect(formatTxDate('2026-06-24T00:00:00.000Z')).toBe('Wed, Jun 24, 2026')
  })
})
