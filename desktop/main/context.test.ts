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

describe('contextFor, apply', () => {
  function setup() {
    const ledger = tempLedger()
    const announced: Changed[][] = []
    const ctx = contextFor(ledger, (changed) => announced.push(changed), {
      now: () => NOW,
      timeZone: () => 'UTC',
    })
    return { ctx, announced }
  }

  test('announces a batch once, after it commits', () => {
    const { ctx, announced } = setup()
    const cash = anAccount()
    const food = anAccount({ path: 'expenses:food', kind: 'category' })
    const spend = aSpend(cash.id, food.id)

    const applied = ctx.apply([cash, food, spend], NOW)

    expect(applied.ok).toBe(true)
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
    expect(announced).toEqual([])
  })
})
