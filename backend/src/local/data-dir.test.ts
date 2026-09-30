import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataDirFor, dataPaths, prepareDataDir } from './data-dir'

describe('dataDirFor', () => {
  it('follows XDG_DATA_HOME', () => {
    expect(dataDirFor({ XDG_DATA_HOME: '/data/me' }, '/home/me')).toBe('/data/me/havefish')
  })

  it('falls back to ~/.local/share, as the spec says, when XDG_DATA_HOME is unset or relative', () => {
    expect(dataDirFor({}, '/home/me')).toBe('/home/me/.local/share/havefish')
    expect(dataDirFor({ XDG_DATA_HOME: '' }, '/home/me')).toBe('/home/me/.local/share/havefish')
    expect(dataDirFor({ XDG_DATA_HOME: 'data' }, '/home/me')).toBe('/home/me/.local/share/havefish')
  })

  it('takes HAVEFISH_DATA_DIR over both', () => {
    expect(dataDirFor({ HAVEFISH_DATA_DIR: '/mnt/usb/fish', XDG_DATA_HOME: '/data/me' })).toBe(
      '/mnt/usb/fish',
    )
  })

  it('keeps the database, the lock and the log inside it', () => {
    expect(dataPaths('/d')).toEqual({
      database: '/d/havefish.sqlite',
      lock: '/d/havefish.lock',
      log: '/d/havefish.log',
      backups: '/d/backups',
      desktopMarker: '/d/desktop-entry',
    })
  })
})

describe('prepareDataDir', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('makes the directory, readable by its owner alone', () => {
    root = mkdtempSync(join(tmpdir(), 'havefish-dir-'))
    const dir = join(root, 'share', 'havefish')
    prepareDataDir(dir)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('closes up one that already exists', () => {
    root = mkdtempSync(join(tmpdir(), 'havefish-dir-'))
    const dir = join(root, 'havefish')
    mkdirSync(dir, { mode: 0o755 })
    prepareDataDir(dir)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })
})
