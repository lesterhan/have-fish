import { describe, expect, test } from 'vitest'
import { appName, ledgerDir } from './paths'

const home = '/home/kim'
const userData = '/home/kim/.config/have-fish'

describe('ledgerDir', () => {
  test('on Linux, under $XDG_DATA_HOME', () => {
    const env = { XDG_DATA_HOME: '/data' }
    expect(ledgerDir({ env, platform: 'linux', home, userData, name: 'have-fish' })).toBe(
      '/data/have-fish',
    )
  })

  test('on Linux without it, or with a relative one the spec says to ignore, ~/.local/share', () => {
    for (const env of [{}, { XDG_DATA_HOME: '' }, { XDG_DATA_HOME: 'data' }]) {
      expect(ledgerDir({ env, platform: 'linux', home, userData, name: 'have-fish' })).toBe(
        '/home/kim/.local/share/have-fish',
      )
    }
  })

  test("elsewhere, in a folder of its own beside the app's settings", () => {
    const env = { XDG_DATA_HOME: '/data' }
    expect(ledgerDir({ env, platform: 'darwin', home, userData, name: 'have-fish' })).toBe(
      '/home/kim/.config/have-fish/ledger',
    )
  })

  test("never the current app's folder", () => {
    const dir = ledgerDir({ env: {}, platform: 'linux', home, userData, name: appName(true) })
    expect(dir).not.toBe('/home/kim/.local/share/havefish')
  })
})

describe('appName', () => {
  test('a development run keeps its own folders, apart from the packaged app’s', () => {
    expect(appName(true)).toBe('have-fish')
    expect(appName(false)).toBe('have-fish-dev')
  })
})
