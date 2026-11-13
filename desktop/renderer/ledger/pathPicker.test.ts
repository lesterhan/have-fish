import { describe, expect, test } from 'vitest'
import type { ListedPath } from '../../shared/commands'
import {
  childrenAt,
  createPath,
  levelOfTyped,
  needleOf,
  offered,
  pathNamed,
  rootOfPath,
  searching,
  textOf,
  trailOf,
} from './pathPicker'

const path = (path: string, kind: ListedPath['kind'], lastUsed: number | null): ListedPath => ({
  id: path,
  path,
  kind,
  lastUsed,
})

const PATHS = [
  path('expenses:food', 'category', 60),
  path('expenses:food:coffee', 'category', 90),
  path('expenses:food:groceries', 'category', 50),
  path('expenses:food:groceries:market', 'category', 80),
  path('expenses:transport:transit', 'category', 40),
  path('expenses:unsorted', 'category', 75),
  path('assets:cash', 'cash', 70),
  path('assets:tangerine:chequing', 'bank', 100),
  path('assets:tangerine:savings', 'bank', 30),
  path('liabilities:cibc:visa', 'card', 95),
  path('income:salary', 'income', 20),
]

describe('what a picker offers', () => {
  test('From: accounts that can pay, and income; never a category', () => {
    expect(offered(PATHS, 'from').map((p) => p.path)).toEqual([
      'assets:cash',
      'assets:tangerine:chequing',
      'assets:tangerine:savings',
      'liabilities:cibc:visa',
      'income:salary',
    ])
  })

  test('To: categories and accounts; never income', () => {
    expect(offered(PATHS, 'to').map((p) => p.path)).not.toContain('income:salary')
    expect(offered(PATHS, 'to').map((p) => p.path)).toContain('expenses:food')
    expect(offered(PATHS, 'to').map((p) => p.path)).toContain('assets:cash')
    // What an empty To means is never a path to pick.
    expect(offered(PATHS, 'to').map((p) => p.path)).not.toContain('expenses:unsorted')
  })
})

describe('the levels', () => {
  test("a level's children, the ones used last first", () => {
    expect(childrenAt(PATHS, 'expenses:food')).toEqual([
      {
        path: 'expenses:food:coffee',
        name: 'coffee',
        pickable: true,
        hasChildren: false,
        lastUsed: 90,
      },
      {
        path: 'expenses:food:groceries',
        name: 'groceries',
        pickable: true,
        hasChildren: true,
        lastUsed: 80,
      },
    ])
  })

  test('a part that is not an account itself still opens', () => {
    expect(childrenAt(PATHS, 'assets')).toContainEqual({
      path: 'assets:tangerine',
      name: 'tangerine',
      pickable: false,
      hasChildren: true,
      lastUsed: 100,
    })
  })

  test('no level lists every path, by when it was used', () => {
    const all = childrenAt(PATHS, null)
    expect(all).toHaveLength(PATHS.length)
    expect(all.slice(0, 3).map((p) => p.path)).toEqual([
      'assets:tangerine:chequing',
      'liabilities:cibc:visa',
      'expenses:food:coffee',
    ])
  })
})

describe('letters find paths', () => {
  test('in order anywhere in the name, without the root', () => {
    expect(searching(PATHS, 'cof').map((p) => p.path)).toEqual(['expenses:food:coffee'])
    expect(searching(PATHS, 'tq').map((p) => p.path)).toEqual(['assets:tangerine:chequing'])
  })

  test('a typed path searches its last part, and ignores the root word', () => {
    expect(needleOf('food:co')).toBe('co')
    expect(needleOf('expenses:food:co')).toBe('co')
    expect(needleOf('co')).toBe('co')
    expect(searching(PATHS, 'food:co').map((p) => p.path)).toEqual(['expenses:food:coffee'])
  })
})

describe('the path a field names', () => {
  const named = (text: string) => pathNamed(PATHS, text)?.path

  test('by its name or its whole path, without regard to case or spaces', () => {
    expect(named('food:coffee')).toBe('expenses:food:coffee')
    expect(named('Food:Coffee')).toBe('expenses:food:coffee')
    expect(named('expenses:food:coffee')).toBe('expenses:food:coffee')
    expect(named(' cash ')).toBe('assets:cash')
  })

  test('none for nothing, or a name no path has', () => {
    expect(named('')).toBeUndefined()
    expect(named('  ')).toBeUndefined()
    expect(named('tea')).toBeUndefined()
  })
})

describe('the trail', () => {
  test('the root and each part under it, each a way back', () => {
    expect(trailOf('expenses:food')).toEqual([
      { name: 'expenses', path: 'expenses', root: true },
      { name: 'food', path: 'expenses:food', root: false },
    ])
    expect(trailOf(null)).toEqual([])
  })

  test('the root is the first part of a path', () => {
    expect(rootOfPath('liabilities:cibc:visa')).toBe('liabilities')
  })

  test('a typed path walks to its deepest existing part', () => {
    expect(levelOfTyped(null, 'food:co', 'to')).toBe('expenses:food')
    expect(levelOfTyped('expenses:food', 'co', 'to')).toBe('expenses:food')
    expect(levelOfTyped(null, 'assets:cibc:visa', 'from')).toBe('assets:cibc')
  })
})

describe('a name not used yet', () => {
  test('To makes a category under the level in view', () => {
    expect(createPath('to', 'expenses:food', 'co')).toEqual({
      path: 'expenses:food:co',
      name: 'food:co',
    })
    expect(createPath('to', null, 'food:co')).toEqual({
      path: 'expenses:food:co',
      name: 'food:co',
    })
  })

  test('From makes an income source', () => {
    expect(createPath('from', null, 'ci')).toEqual({ path: 'income:ci', name: 'ci' })
    expect(createPath('from', 'income', 'salary')).toEqual({
      path: 'income:salary',
      name: 'salary',
    })
  })

  test('nothing typed creates nothing', () => {
    expect(createPath('to', 'expenses:food', '  ')).toBeNull()
  })
})

describe('what a pick puts in the field', () => {
  test('its path without the root, at a level as from a search', () => {
    expect(childrenAt(offered(PATHS, 'from'), 'assets:tangerine').map(textOf)).toEqual([
      'tangerine:chequing',
      'tangerine:savings',
    ])
    expect(childrenAt(PATHS, 'expenses:food').map(textOf)).toContain('food:coffee')
    expect(searching(PATHS, 'visa').map(textOf)).toEqual(['cibc:visa'])
  })
})
