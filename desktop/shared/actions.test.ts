import { describe, expect, test } from 'vitest'
import { copy } from '../copy'
import { ACTIONS, type Action, actionFor, sharedAccelerators } from './actions'

const action = (id: string, accelerator: string): Action => ({ id, menu: 'file', accelerator })

describe('sharedAccelerators', () => {
  test('two actions on one accelerator', () => {
    expect(sharedAccelerators([action('a', 'CmdOrCtrl+N'), action('b', 'CmdOrCtrl+N')])).toEqual([
      'cmdorctrl+n',
    ])
  })

  test('however each one is spelled', () => {
    expect(
      sharedAccelerators([
        action('a', 'Shift+CommandOrControl+Z'),
        action('b', 'cmdorctrl+shift+z'),
        action('c', 'CmdOrCtrl+Z'),
      ]),
    ).toEqual(['cmdorctrl+shift+z'])
  })

  test('different keys are fine, and so is minus', () => {
    expect(sharedAccelerators([action('a', 'CmdOrCtrl+-'), action('b', 'CmdOrCtrl+=')])).toEqual([])
  })
})

describe('the list', () => {
  test('no two actions share an accelerator', () => {
    expect(sharedAccelerators(ACTIONS)).toEqual([])
  })

  test('no two actions share an id', () => {
    const ids = ACTIONS.map((a) => a.id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  test('every action has words in copy/', () => {
    const labels: Record<string, unknown> = copy.actions.labels
    const unlabelled = ACTIONS.filter(
      (a) =>
        !Object.hasOwn(labels, a.id) || typeof labels[a.id] !== 'string' || labels[a.id] === '',
    )
    expect(unlabelled.map((a) => a.id)).toEqual([])
  })

  test('every label in copy/ is for an action', () => {
    const ids: string[] = ACTIONS.map((a) => a.id)
    expect(Object.keys(copy.actions.labels).filter((id) => !ids.includes(id))).toEqual([])
  })

  test('an action is found by its id', () => {
    expect(actionFor('saveAll').accelerator).toBe('CmdOrCtrl+S')
  })
})
