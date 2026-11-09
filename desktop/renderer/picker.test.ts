import { describe, expect, test } from 'vitest'
import { finds, fromOf, named, toOf } from './picker'

const cash = { id: 'c', name: 'cash' }
const chequing = { id: 'q', name: 'Chequing' }
const visa = { id: 'v', name: 'visa' }
const wise = { id: 'w', name: 'wise:cad' }
const MINE = [cash, chequing, visa, wise]

describe('finds', () => {
  test.each([
    ['visa', 'visa'],
    ['visa', 'vs'],
    ['visa', 'VI'],
    ['Chequing', 'cheq'],
    ['wise:cad', 'w:c'],
    ['visa', ' vis '],
    ['visa', ''],
  ])('%j is found by %j', (name, typed) => {
    expect(finds(name, typed)).toBe(true)
  })

  test.each([
    ['visa', 'sv'],
    ['visa', 'visas'],
    ['cash', 'x'],
  ])('%j is not found by %j', (name, typed) => {
    expect(finds(name, typed)).toBe(false)
  })
})

describe('named', () => {
  test('the one whose name it is, without regard to case or spaces around it', () => {
    expect(named(MINE, ' VISA ')).toBe(visa)
  })

  test('a part of a name names nothing', () => {
    expect(named(MINE, 'vis')).toBeUndefined()
  })
})

describe('toOf', () => {
  test('an account of mine, by name, whatever its case: a transfer to it', () => {
    expect(toOf(MINE, ' VISA ')).toEqual({ account: 'v' })
  })

  test('anything else is a category, as typed; empty is unsorted', () => {
    expect(toOf(MINE, 'food')).toEqual({ category: 'food' })
    expect(toOf(MINE, '')).toEqual({ category: '' })
  })
})

describe('fromOf', () => {
  test('empty sends null, so main assumes the account used last', () => {
    expect(fromOf(MINE, ' ')).toBeNull()
  })

  test('a name of mine sends its id', () => {
    expect(fromOf(MINE, 'Visa')).toBe('v')
  })

  test('anything else is an income source, as typed', () => {
    expect(fromOf(MINE, 'salary')).toEqual({ income: 'salary' })
    expect(fromOf([], 'cash')).toEqual({ income: 'cash' })
  })
})
