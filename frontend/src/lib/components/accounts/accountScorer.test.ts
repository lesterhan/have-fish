/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import { rank, scoreOne, type ScorableAccount } from './accountScorer'

// A plausible personal-finance ledger. `freq` drives the gentle tie-break,
// so the expected rankings below are deterministic.
const ACCOUNTS: ScorableAccount[] = [
  { path: 'assets:bank:chequing', freq: 142 },
  { path: 'assets:bank:savings', freq: 38 },
  { path: 'assets:bank:savings:usd', freq: 24 },
  { path: 'assets:wise:czk', freq: 51 },
  { path: 'assets:wise:eur', freq: 19 },
  { path: 'assets:cash:wallet', freq: 27 },
  { path: 'assets:receivable:household', freq: 64 },
  { path: 'assets:receivable:quotidien', freq: 33 },
  { path: 'assets:investments:brokerage', freq: 9 },
  { path: 'assets:investments:tfsa', freq: 6 },
  { path: 'expenses:food:groceries', freq: 118 },
  { path: 'expenses:food:restaurants', freq: 86 },
  { path: 'expenses:food:restaurants:burgerking', freq: 21 },
  { path: 'expenses:food:restaurants:sushi', freq: 14 },
  { path: 'expenses:food:coffee', freq: 97 },
  { path: 'expenses:food:coffee:starbucks', freq: 12 },
  { path: 'expenses:food:delivery', freq: 44 },
  { path: 'expenses:housing:rent', freq: 36 },
  { path: 'expenses:housing:utilities', freq: 41 },
  { path: 'expenses:housing:insurance', freq: 12 },
  { path: 'expenses:home:furniture', freq: 7 },
  { path: 'expenses:home:decor', freq: 5 },
  { path: 'expenses:home:supplies', freq: 16 },
  { path: 'expenses:utilities:phone', freq: 24 },
  { path: 'expenses:utilities:internet', freq: 24 },
  { path: 'expenses:utilities:electricity', freq: 22 },
  { path: 'expenses:transport:transit', freq: 73 },
  { path: 'expenses:transport:taxi', freq: 29 },
  { path: 'expenses:transport:fuel', freq: 18 },
  { path: 'expenses:shopping:clothing', freq: 31 },
  { path: 'expenses:shopping:electronics', freq: 15 },
  { path: 'expenses:shopping:returns', freq: 8 },
  { path: 'expenses:health:pharmacy', freq: 26 },
  { path: 'expenses:health:dental', freq: 6 },
  { path: 'expenses:entertainment:streaming', freq: 20 },
  { path: 'expenses:entertainment:games', freq: 13 },
  { path: 'expenses:fees:fx', freq: 17 },
  { path: 'expenses:fees:bank', freq: 9 },
  { path: 'income:salary', freq: 24 },
  { path: 'income:freelance', freq: 11 },
  { path: 'income:interest', freq: 8 },
  { path: 'income:refund', freq: 14 },
  { path: 'liabilities:creditcard:visa', freq: 88 },
  { path: 'liabilities:creditcard:amex', freq: 47 },
  { path: 'equity:opening', freq: 4 },
  { path: 'equity:conversions', freq: 30 },
]

const paths = (q: string) => rank(q, ACCOUNTS).map((r) => r.path)

describe('rank — expected rankings', () => {
  it('expenses:hou → housing before any home (no scatter pollution)', () => {
    const top = paths('expenses:hou')
    expect(top.slice(0, 3)).toEqual([
      'expenses:housing:utilities',
      'expenses:housing:rent',
      'expenses:housing:insurance',
    ])
    // The whole point: no home:* ever ranks above a housing:* result.
    const firstHome = top.findIndex((p) => p.startsWith('expenses:home:'))
    const lastHousing = top.reduce(
      (acc, p, i) => (p.startsWith('expenses:housing:') ? i : acc),
      -1,
    )
    expect(firstHome).toBeGreaterThan(lastHousing)
  })

  it('rent → housing:rent first (exact-leaf jackpot), restaurants below', () => {
    const top = paths('rent')
    expect(top[0]).toBe('expenses:housing:rent')
    expect(top.indexOf('expenses:food:restaurants')).toBeGreaterThan(0)
  })

  it('foodburger → expenses:food:restaurants:burgerking', () => {
    expect(paths('foodburger')[0]).toBe('expenses:food:restaurants:burgerking')
  })

  it('recvhouse → assets:receivable:household', () => {
    expect(paths('recvhouse')[0]).toBe('assets:receivable:household')
  })

  it('coffee → coffee leaf first, then coffee:starbucks', () => {
    const top = paths('coffee')
    expect(top[0]).toBe('expenses:food:coffee')
    expect(top[1]).toBe('expenses:food:coffee:starbucks')
  })
})

describe('rank — query normalization', () => {
  it('treats food:rest, foodrest, and food rest identically', () => {
    const a = paths('food:rest')
    const b = paths('foodrest')
    const c = paths('food rest')
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('is case-insensitive', () => {
    expect(paths('RENT')).toEqual(paths('rent'))
  })

  it('empty query returns the full list, sorted by freq desc', () => {
    const ranked = rank('', ACCOUNTS)
    expect(ranked.length).toBe(ACCOUNTS.length)
    expect(ranked[0].path).toBe('assets:bank:chequing') // freq 142, highest
    expect(ranked.every((r) => r.score === 0)).toBe(true)
  })
})

describe('rank — exclusion + tie-break fallbacks', () => {
  it('drops paths the query is not a subsequence of', () => {
    expect(paths('zzzz')).toEqual([])
  })

  it('falls back to alphabetical when freq is absent (all zero)', () => {
    const noFreq: ScorableAccount[] = [
      { path: 'expenses:utilities:phone' },
      { path: 'expenses:utilities:internet' },
      { path: 'expenses:utilities:electricity' },
    ]
    // All three: query at segStart of "utilities", identical match quality,
    // freq 0 → alphabetical by full path.
    expect(rank('util', noFreq).map((r) => r.path)).toEqual([
      'expenses:utilities:electricity',
      'expenses:utilities:internet',
      'expenses:utilities:phone',
    ])
  })
})

describe('scoreOne', () => {
  it('returns null for a non-subsequence', () => {
    expect(scoreOne('xyz', 'expenses:food:coffee')).toBeNull()
  })

  it('returns matched positions for highlight spans', () => {
    // "rent" against expenses:housing:rent → the 4 chars of the leaf segment.
    const path = 'expenses:housing:rent'
    const r = scoreOne('rent', path)
    expect(r).not.toBeNull()
    expect(r!.pos.map((i) => path[i]).join('')).toBe('rent')
  })

  it('scores an exact-leaf match above a scattered subsequence', () => {
    const exact = scoreOne('rent', 'expenses:housing:rent')!
    const scattered = scoreOne('rent', 'expenses:food:restaurants')!
    expect(exact.score).toBeGreaterThan(scattered.score)
  })

  it('empty query scores 0 with no positions', () => {
    expect(scoreOne('', 'expenses:food:coffee')).toEqual({ score: 0, pos: [] })
  })

  it('rewards segment-start contiguous matches over stranded ones', () => {
    // "hou" contiguous at the start of "housing" beats h·o in "home" + stranded u.
    const housing = scoreOne('hou', 'expenses:housing:rent')!
    const home = scoreOne('hou', 'expenses:home:furniture')!
    expect(housing.score).toBeGreaterThan(home.score)
  })
})
