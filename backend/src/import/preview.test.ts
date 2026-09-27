import { describe, expect, it } from 'bun:test'
import { matchParser, type PreviewRule, suggest } from './preview'
import type { ParsedTransaction } from './types'

// No database here: which parser a file belongs to, and what each row suggests.

describe('matchParser', () => {
  const commaParser = { name: 'comma', normalizedHeader: 'amount|date|description' }

  it('matches on the header fingerprint, whatever the column order and case', () => {
    const { rows, parser } = matchParser('Description,Date,Amount\nCoffee,2026-03-01,-4.50\n', [
      commaParser,
    ])
    expect(parser).toBe(commaParser)
    expect(rows).toEqual([{ description: 'Coffee', date: '2026-03-01', amount: '-4.50' }])
  })

  it('tries the other delimiters when the detected one matches no parser', () => {
    // A header of one column with commas in it: detection guesses comma, the parser says
    // semicolon.
    const semicolon = { name: 'semi', normalizedHeader: 'amount|date,time' }
    const { parser, rows } = matchParser('Date,Time;Amount\n2026-03-01 10:00;-4.50\n', [semicolon])
    expect(parser).toBe(semicolon)
    expect(rows).toEqual([{ 'date,time': '2026-03-01 10:00', amount: '-4.50' }])
  })

  it('answers no parser, and the rows it read, when nothing matches', () => {
    const { parser, rows } = matchParser('Foo,Bar\n1,2\n', [commaParser])
    expect(parser).toBeUndefined()
    expect(rows.length).toBeGreaterThan(0)
  })

  it('answers no rows for an empty file', () => {
    expect(matchParser('', [commaParser])).toEqual({ rows: [], parser: undefined })
  })
})

describe('suggest', () => {
  const regular = (description?: string): ParsedTransaction => ({
    isTransfer: false,
    date: '2026-03-01T00:00:00.000Z',
    amount: '-4.50',
    ...(description === undefined ? {} : { description }),
  })
  const crossCurrency = (description: string): ParsedTransaction => ({
    isTransfer: true,
    date: '2026-03-01T00:00:00.000Z',
    description,
    sourceAmount: '-15.20',
    sourceCurrency: 'CAD',
    targetAmount: '10.00',
    targetCurrency: 'EUR',
  })
  const rules: PreviewRule[] = [
    { pattern: 'STARBUCKS', accountId: 'coffee', groupId: null, categoryId: null },
    { pattern: 'grocer', accountId: null, groupId: 'flat', categoryId: 'food' },
    { pattern: 'star', accountId: 'never', groupId: null, categoryId: null },
  ]

  it('suggests the offset account of the first rule whose pattern the description contains', () => {
    const [row] = suggest([regular('Starbucks #1234 Toronto')], rules, '')
    expect(row).toMatchObject({
      suggestedOffsetAccountId: 'coffee',
      matchedRulePattern: 'STARBUCKS',
    })
  })

  it('suggests a group and category from a split rule', () => {
    const [row] = suggest([regular('Local Grocer')], rules, '')
    expect(row).toMatchObject({
      suggestedGroupId: 'flat',
      suggestedCategoryId: 'food',
      matchedRulePattern: 'grocer',
    })
    expect(row).not.toHaveProperty('suggestedOffsetAccountId')
  })

  it('stamps a merchant key on every row with a description, matched or not', () => {
    const [matched, unmatched, bare] = suggest(
      [regular('Starbucks #1234'), regular('Corner shop'), regular()],
      rules,
      '',
    )
    expect(matched).toHaveProperty('merchantKey')
    expect(unmatched).toHaveProperty('merchantKey')
    expect(unmatched).not.toHaveProperty('matchedRulePattern')
    expect(bare).not.toHaveProperty('merchantKey')
  })

  it("marks a cross-currency row as the user's own transfer when it names them", () => {
    const [own, spend] = suggest(
      [crossCurrency('To Lester Han'), crossCurrency('Starbucks Lyon')],
      rules,
      'lester han',
    )
    expect(own).toMatchObject({ suggestedKind: 'transfer' })
    expect(own).not.toHaveProperty('matchedRulePattern')
    expect(spend).toMatchObject({ suggestedKind: 'spend', suggestedExpenseAccountId: 'coffee' })
  })

  it('treats every cross-currency row as a spend when the user has no name', () => {
    const [row] = suggest([crossCurrency('To Lester Han')], rules, '')
    expect(row).toMatchObject({ suggestedKind: 'spend' })
  })
})
