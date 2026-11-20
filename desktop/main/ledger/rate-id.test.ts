import { describe, expect, test } from 'vitest'
import { aRate, MAKER, NOW } from './fixtures'
import { rateId } from './rate-id'

const SYSTEM = { source: 'system', createdAt: NOW, deviceId: MAKER } as const

describe('rateId', () => {
  test('is a version 5 UUID', () => {
    expect(rateId(aRate())).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  test('is the same for a pair either way round', () => {
    expect(rateId(aRate({ from: 'JPY', to: 'CAD' }))).toBe(rateId(aRate()))
  })

  test('is another for another day', () => {
    expect(rateId(aRate({ date: '2026-11-06' }))).not.toBe(rateId(aRate()))
  })

  test('is another for another source, on the same day and pair', () => {
    expect(rateId(aRate({ origin: SYSTEM }))).not.toBe(rateId(aRate()))
  })

  test('is another for another pair', () => {
    expect(rateId(aRate({ to: 'EUR' }))).not.toBe(rateId(aRate()))
  })

  test('is fixed by its namespace and name', () => {
    expect(rateId(aRate())).toBe('0b6747ba-b0dc-5443-9d3b-ae01cc54d943')
  })
})
