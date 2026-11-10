import { describe, expect, test } from 'vitest'
import { copy } from '../copy'
import type { Bridge, CommandName, ListedTransaction, WireFailure } from '../shared/commands'
import { spendActions } from './spendActions'

const spend: ListedTransaction = {
  id: 'a',
  date: '2026-10-29',
  description: 'Coffee',
  amounts: [{ amount: '4.50', currency: 'CAD' }],
  simple: { amount: '4.50', currency: 'CAD' },
  from: 'cash',
  to: 'food',
  fromPath: 'assets:cash',
  toPath: 'expenses:food',
  legs: [],
  origin: { source: 'manual', at: 0, here: true, file: null, line: null },
}
const toOf = (typed: string) => ({ category: typed })

/** A bridge that answers each command as told, `null` saved by default, and keeps what it sent. */
function fakeBridge(answers: Partial<Record<CommandName, unknown>> = {}) {
  const sent: [CommandName, unknown][] = []
  const bridge = {
    async invoke(name: CommandName, input: unknown) {
      sent.push([name, input])
      return answers[name] ?? { ok: true, value: null }
    },
  } as Pick<Bridge, 'invoke'>
  return { actions: spendActions(bridge), sent }
}

const refusal = (failure: Omit<WireFailure, 'ok'>) => ({ ok: false, ...failure })

describe('remove', () => {
  test('saved: it sends the spend by its id', async () => {
    const { actions, sent } = fakeBridge()
    expect(await actions.remove('a')).toEqual({ ok: true })
    expect(sent).toEqual([['spend.remove', { id: 'a' }]])
  })

  test('refused: the words for why', async () => {
    const { actions } = fakeBridge({
      'spend.remove': refusal({ error: 'TRANSACTION_NOT_FOUND', detail: { id: 'a' } }),
    })
    expect(await actions.remove('a')).toEqual({
      ok: false,
      words: copy.errors.codes.TRANSACTION_NOT_FOUND,
    })
  })
})

describe('refile', () => {
  test('saved: only its To changes, the rest goes as it was', async () => {
    const { actions, sent } = fakeBridge()
    expect(await actions.refile(spend, 'transit', toOf)).toEqual({ ok: true })
    expect(sent).toEqual([
      [
        'spend.edit',
        { id: 'a', amount: '4.50', description: 'Coffee', to: { category: 'transit' } },
      ],
    ])
  })

  test('the To it has already: nothing to send', async () => {
    const { actions, sent } = fakeBridge()
    expect(await actions.refile(spend, ' food ', toOf)).toEqual({ ok: true })
    expect(sent).toEqual([])
  })

  test('a spend of more than one amount: nothing to send', async () => {
    const { actions, sent } = fakeBridge()
    expect(await actions.refile({ ...spend, simple: null }, 'transit', toOf)).toEqual({ ok: true })
    expect(sent).toEqual([])
  })

  test('refused: a bad path is said as a category', async () => {
    const { actions } = fakeBridge({
      'spend.edit': refusal({ error: 'PATH_INVALID', detail: { path: 'expenses:a::b' } }),
    })
    expect(await actions.refile(spend, 'a::b', toOf)).toEqual({
      ok: false,
      words: copy.spends.write.badCategory,
    })
  })
})

describe('edit', () => {
  const change = { id: 'a', amount: '5', description: 'Coffee' }

  test('saved: it sends the change as given', async () => {
    const { actions, sent } = fakeBridge()
    expect(await actions.edit(change)).toEqual({ ok: true })
    expect(sent).toEqual([['spend.edit', change]])
  })

  test("refused: a day it can't read says how to type one", async () => {
    const { actions } = fakeBridge({
      'spend.edit': refusal({ error: 'DATE_INVALID', detail: { date: 'soon' } }),
    })
    expect(await actions.edit({ ...change, date: 'soon' })).toEqual({
      ok: false,
      words: copy.spends.dateUnread,
    })
  })
})

describe('write', () => {
  const values = { amount: '4.50', description: 'Coffee', from: null, to: { category: 'food' } }

  test('saved: the new spend, by its id', async () => {
    const { actions, sent } = fakeBridge({ 'spend.write': { ok: true, value: { id: 'b' } } })
    expect(await actions.write(values)).toEqual({ ok: true, id: 'b' })
    expect(sent).toEqual([['spend.write', values]])
  })

  test('refused: the part to underline, and its two words', async () => {
    const { actions } = fakeBridge({
      'spend.write': refusal({ error: 'AMOUNT_INVALID', detail: { amount: 'x' } }),
    })
    expect(await actions.write({ ...values, amount: 'x' })).toEqual({
      ok: false,
      part: 'amount',
      words: copy.spends.composer.refused.amount,
    })
  })

  test('refused for an account To named: To is the part', async () => {
    const to = { account: '00000000-0000-4000-8000-000000000001' }
    const { actions } = fakeBridge({
      'spend.write': refusal({ error: 'ACCOUNT_DELETED', detail: { accountId: to.account } }),
    })
    const written = await actions.write({ ...values, to })
    expect(written.ok === false && written.part).toBe('to')
  })
})
