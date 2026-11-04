import { describe, expect, test } from 'vitest'
import { actionFor } from '../shared/actions'
import { PLACES, SHOW, shownBy } from './places'

describe('shownBy', () => {
  test('a step that moved spends shows the first in Spends', () => {
    expect(shownBy({ spends: ['a', 'b'], accounts: [] }, 'accounts')).toEqual({
      place: 'spends',
      id: 'a',
    })
  })

  test('in Reports, a spend shows where it is', () => {
    expect(shownBy({ spends: ['a'], accounts: [] }, 'reports')).toEqual({
      place: 'reports',
      id: 'a',
    })
  })

  test('one that moved an account shows it in Accounts, from anywhere', () => {
    expect(shownBy({ spends: [], accounts: ['c'] }, 'reports')).toEqual({
      place: 'accounts',
      id: 'c',
    })
  })

  test('nothing moved, nothing to show', () => {
    expect(shownBy({ spends: [], accounts: [] }, 'spends')).toBeNull()
  })
})

describe('SHOW', () => {
  test('every place has an action, in the View menu, in the sidebar’s order', () => {
    expect(PLACES.map((p) => actionFor(SHOW[p]).accelerator)).toEqual([
      'CmdOrCtrl+1',
      'CmdOrCtrl+2',
      'CmdOrCtrl+3',
    ])
  })
})
