import { expect, test } from 'vitest'
import { cannotOpen } from './copy'

test('a ledger from a newer build says to update, and that nothing changed', () => {
  const words = cannotOpen({
    code: 'LEDGER_TOO_NEW',
    details: { path: '/data/have-fish/ledger.sqlite', unknown: ['0009_later'] },
  })
  expect(words.message).toContain('newer')
  expect(words.message).toContain('/data/have-fish/ledger.sqlite')
  expect(words.message).toContain('Nothing was changed')
})

test('a file that is not a ledger names the file', () => {
  const words = cannotOpen({
    code: 'LEDGER_UNREADABLE',
    details: { path: '/data/have-fish/ledger.sqlite' },
  })
  expect(words.message).toContain('/data/have-fish/ledger.sqlite')
})

test('any other refusal still gets a title and its code', () => {
  const words = cannotOpen({ code: 'TOO_FEW_POSTINGS', details: undefined })
  expect(words.title).not.toBe('')
  expect(words.message).toContain('TOO_FEW_POSTINGS')
})
