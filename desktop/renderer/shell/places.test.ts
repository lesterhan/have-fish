import { describe, expect, test } from 'vitest'
import { actionFor } from '../../shared/actions'
import { listsSpends, PLACES, type Place, SHOW, showHandlers, shownBy } from './places'

describe('shownBy', () => {
  test('a step that moved spends shows the first in the ledger', () => {
    expect(shownBy({ spends: ['a', 'b'], accounts: [] }, 'accounts')).toEqual({
      place: 'ledger',
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
    expect(shownBy({ spends: [], accounts: [] }, 'ledger')).toBeNull()
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

describe('listsSpends', () => {
  test('spends are listed in the Ledger and Reports, not in Accounts', () => {
    expect(PLACES.filter(listsSpends)).toEqual(['ledger', 'reports'])
  })
})

describe('showHandlers', () => {
  test('each place’s action goes to that place, one handler per place', () => {
    const went: Place[] = []
    const handlers = showHandlers((p) => went.push(p))
    handlers.showAccounts()
    handlers.showReports()
    handlers.showLedger()
    expect(went).toEqual(['accounts', 'reports', 'ledger'])
    expect(Object.keys(handlers)).toEqual(['showLedger', 'showAccounts', 'showReports'])
  })
})
