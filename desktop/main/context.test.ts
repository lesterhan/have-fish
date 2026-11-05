import type { Version } from '@have-fish/core/version'
import { describe, expect, test } from 'vitest'
import type { Changed } from '../shared/commands'
import { changesOf, contextFor } from './context'
import type { Written } from './ledger/apply'
import { anAccount, aSpend, NOW, tempLedger } from './ledger/fixtures'

const v = (counter: number): Version => ({ wallMs: NOW, counter, deviceId: 'a1b2c3d4e5f60718' })
const A = '00000000-0000-4000-8000-00000000000a'
const T = '00000000-0000-4000-8000-00000000000b'

describe('changesOf', () => {
  test('names each document once, in the order the batch first wrote it', () => {
    const written: Written[] = [
      { type: 'account', id: A, version: v(0) },
      { type: 'transaction', id: T, version: v(1) },
      { type: 'transaction', id: T, version: v(2) },
    ]
    expect(changesOf(written)).toEqual([
      { type: 'account', id: A },
      { type: 'transaction', id: T },
    ])
  })
})

describe('contextFor, apply and flush', () => {
  function setup() {
    const ledger = tempLedger()
    const announced: Changed[][] = []
    const ctx = contextFor(ledger, (changed) => announced.push(changed), {
      now: () => NOW,
      timeZone: () => 'UTC',
    })
    return { ctx, announced }
  }

  test('announces what a batch wrote at the flush, each document once', () => {
    const { ctx, announced } = setup()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const spend = aSpend(cash.id, food.id)

    const applied = ctx.apply([cash, food, spend], NOW)

    expect(applied.ok).toBe(true)
    ctx.flush()
    expect(announced).toEqual([
      [
        { type: 'account', id: cash.id },
        { type: 'account', id: food.id },
        { type: 'transaction', id: spend.id },
      ],
    ])
  })

  test('says nothing about a refused batch', () => {
    const { ctx, announced } = setup()
    const spend = aSpend(anAccount().id, anAccount().id)

    const applied = ctx.apply([spend], NOW)

    expect(applied.ok).toBe(false)
    ctx.flush()
    expect(announced).toEqual([])
  })

  test('two batches, then a flush: one notice, each document once, and nothing at the next', () => {
    const { ctx, announced } = setup()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const spend = aSpend(cash.id, food.id)

    ctx.apply([cash, food, spend], NOW)
    ctx.apply([{ ...spend, description: 'Edited' }], NOW + 1)
    expect(announced).toEqual([])
    ctx.flush()
    ctx.flush()

    expect(announced).toEqual([
      [
        { type: 'account', id: cash.id },
        { type: 'account', id: food.id },
        { type: 'transaction', id: spend.id },
      ],
    ])
  })
})
