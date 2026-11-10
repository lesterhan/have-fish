import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { forgetful, settingsIn } from './machine'

const VISA = '3f0c6a52-6a4e-4b8a-9d1e-2b7c4f1a0e11'
const WISE = '9b2d1c7e-0f3a-4e5b-8c6d-7a1e2f3b4c5d'

const aDir = () => join(mkdtempSync(join(tmpdir(), 'havefish-machine-')), 'config')

describe('settingsIn', () => {
  test('remembers nothing at first', () => {
    expect(settingsIn(aDir()).lastFrom()).toBeNull()
  })

  test('the account used last is there after the app starts again', () => {
    const dir = aDir()
    settingsIn(dir).usedFrom(VISA)
    settingsIn(dir).usedFrom(WISE)

    expect(settingsIn(dir).lastFrom()).toBe(WISE)
  })

  test('the file is private to you', () => {
    const dir = aDir()
    settingsIn(dir).usedFrom(VISA)

    expect(statSync(join(dir, 'settings.json')).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  test.each(['not json', '[]', '{"lastFrom": 7}', '{"lastFrom": "visa"}'])(
    'a file holding %j remembers nothing, and is written over',
    (text) => {
      const dir = aDir()
      settingsIn(dir).usedFrom(VISA)
      writeFileSync(join(dir, 'settings.json'), text)

      const machine = settingsIn(dir)
      expect(machine.lastFrom()).toBeNull()
      machine.usedFrom(WISE)
      expect(settingsIn(dir).lastFrom()).toBe(WISE)
    },
  )

  test('keeps what a newer version wrote beside it', () => {
    const dir = aDir()
    settingsIn(dir).usedFrom(VISA)
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ lastFrom: VISA, theme: 'dark' }))

    settingsIn(dir).usedFrom(WISE)

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ lastFrom: WISE, theme: 'dark' })
  })

  test('a folder it cannot write to is remembered until the app quits', () => {
    const blocked = join(mkdtempSync(join(tmpdir(), 'havefish-machine-')), 'file')
    writeFileSync(blocked, '')
    const machine = settingsIn(join(blocked, 'config'))

    machine.usedFrom(VISA)

    expect(machine.lastFrom()).toBe(VISA)
    machine.chooseTheme('graphite-dark')
    expect(machine.theme()).toBe('graphite-dark')
  })
})

describe('the theme', () => {
  test('follows the system until one is chosen', () => {
    expect(settingsIn(aDir()).theme()).toBe('system')
  })

  test('a chosen theme is there after the app starts again', () => {
    const dir = aDir()
    settingsIn(dir).chooseTheme('graphite-dark')
    expect(settingsIn(dir).theme()).toBe('graphite-dark')
  })

  test.each(['{"theme": "solarized"}', '{"theme": 7}', '{"theme": null}', 'not json'])(
    'a file holding %s follows the system',
    (text) => {
      const dir = aDir()
      settingsIn(dir).usedFrom(VISA)
      writeFileSync(join(dir, 'settings.json'), text)
      expect(settingsIn(dir).theme()).toBe('system')
    },
  )

  test('a theme this version does not know is kept when the file is written', () => {
    const dir = aDir()
    settingsIn(dir).usedFrom(VISA)
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ lastFrom: VISA, theme: 'my-own' }))

    settingsIn(dir).usedFrom(WISE)

    expect(JSON.parse(readFileSync(file, 'utf8')).theme).toBe('my-own')
  })

  test('choosing keeps the account used last', () => {
    const dir = aDir()
    settingsIn(dir).usedFrom(VISA)
    settingsIn(dir).chooseTheme('graphite-light')
    expect(settingsIn(dir).lastFrom()).toBe(VISA)
  })
})

describe('the density', () => {
  test('is Regular until one is chosen', () => {
    expect(settingsIn(aDir()).density()).toBe('regular')
  })

  test('a chosen density is there after the app starts again', () => {
    const dir = aDir()
    settingsIn(dir).chooseDensity('comfortable')
    expect(settingsIn(dir).density()).toBe('comfortable')
  })

  test.each(['{"density": "huge"}', '{"density": 7}', '{"density": null}', 'not json'])(
    'a file holding %s opens as Regular',
    (text) => {
      const dir = aDir()
      settingsIn(dir).usedFrom(VISA)
      writeFileSync(join(dir, 'settings.json'), text)
      expect(settingsIn(dir).density()).toBe('regular')
    },
  )

  test('a settings file with density huge, then chooseTheme: the file still says huge', () => {
    const dir = aDir()
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ density: 'huge' }))

    settingsIn(dir).chooseTheme('graphite-dark')

    expect(JSON.parse(readFileSync(file, 'utf8')).density).toBe('huge')
  })
})

describe('forgetful', () => {
  test('remembers until it is gone', () => {
    const machine = forgetful()
    machine.usedFrom(VISA)
    expect(machine.lastFrom()).toBe(VISA)
    machine.chooseTheme('graphite-dark')
    expect(machine.theme()).toBe('graphite-dark')
    machine.chooseDensity('large')
    expect(machine.density()).toBe('large')
  })
})
