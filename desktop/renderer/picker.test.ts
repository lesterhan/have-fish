import { describe, expect, test } from 'vitest'
import { finds, fromOf, matching, named, stepped } from './picker'

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

describe('matching', () => {
  test('keeps the order given', () => {
    expect(matching(MINE, 'c')).toEqual([cash, chequing, wise])
  })

  test('nothing typed finds them all', () => {
    expect(matching(MINE, '  ')).toEqual(MINE)
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

describe('stepped', () => {
  test('down and up, wrapping at the ends', () => {
    expect(stepped(0, 'ArrowDown', 3)).toBe(1)
    expect(stepped(2, 'ArrowDown', 3)).toBe(0)
    expect(stepped(0, 'ArrowUp', 3)).toBe(2)
  })

  test('nowhere for other keys, or with nothing shown', () => {
    expect(stepped(0, 'Enter', 3)).toBeUndefined()
    expect(stepped(0, 'ArrowDown', 0)).toBeUndefined()
  })
})

describe('fromOf', () => {
  test('empty sends null, so main assumes the account used last', () => {
    expect(fromOf(MINE, ' ')).toBeNull()
  })

  test('a name of mine sends its id', () => {
    expect(fromOf(MINE, 'Visa')).toBe('v')
  })

  test('anything else is none of mine', () => {
    expect(fromOf(MINE, 'amex')).toBeUndefined()
    expect(fromOf([], 'cash')).toBeUndefined()
  })
})
