import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopEntry, desktopPaths, execValue, installDesktopEntry } from './desktop-entry'

describe('execValue', () => {
  it('quotes the path, so a space in it is not two arguments', () => {
    expect(execValue('/home/me/bin/havefish')).toBe('"/home/me/bin/havefish"')
    expect(execValue('/home/me/My Apps/havefish')).toBe('"/home/me/My Apps/havefish"')
  })

  it('escapes what the spec says a quoted argument must, and a backslash twice over', () => {
    expect(execValue('/a"b')).toBe('"/a\\\\"b"')
    expect(execValue('/a$b')).toBe('"/a\\\\$b"')
    expect(execValue('/a`b')).toBe('"/a\\\\`b"')
    // One backslash in the path is four in the file: quoting doubles it, the string escape again.
    expect(execValue('/a\\b')).toBe('"/a\\\\\\\\b"')
  })

  it('doubles a percent sign, which would otherwise start a field code', () => {
    expect(execValue('/home/me/100%/havefish')).toBe('"/home/me/100%%/havefish"')
  })

  it('refuses a path no single line can hold', () => {
    expect(() => execValue('/a\nb')).toThrow('cannot write')
  })
})

describe('desktopEntry', () => {
  const entry = desktopEntry('/opt/have fish/havefish', '/home/me/.local/share/icons/x.svg')

  it('launches the binary with no terminal, under the icon it names by path', () => {
    const lines = entry.split('\n')
    expect(lines[0]).toBe('[Desktop Entry]')
    expect(lines).toContain('Type=Application')
    expect(lines).toContain('Name=have-fish')
    expect(lines).toContain('Exec="/opt/have fish/havefish"')
    expect(lines).toContain('Icon=/home/me/.local/share/icons/x.svg')
    expect(lines).toContain('Terminal=false')
    expect(entry.endsWith('\n')).toBe(true)
  })

  // The freedesktop validator, where it is installed (desktop-file-utils); CI's runner lacks it.
  const validator = Bun.which('desktop-file-validate')
  it.skipIf(!validator)('passes desktop-file-validate, awkward paths included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'havefish-desktop-'))
    try {
      for (const exe of ['/usr/bin/havefish', '/home/me/My $Apps/100%/"x"/have\\fish']) {
        const file = join(dir, 'havefish.desktop')
        writeFileSync(file, desktopEntry(exe, '/home/me/.local/share/icons/havefish.svg'))
        const run = Bun.spawnSync([validator ?? '', file])
        expect(`${run.stdout}${run.stderr}`).toBe('')
        expect(run.exitCode).toBe(0)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('installDesktopEntry', () => {
  let root: string
  let dataHome: string
  let marker: string
  const icon = '<svg xmlns="http://www.w3.org/2000/svg"/>'
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'havefish-menu-'))
    dataHome = join(root, 'share')
    marker = join(root, 'desktop-entry')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const install = (executable = '/home/me/havefish', withIcon = icon) =>
    installDesktopEntry({ executable, icon: withIcon, dataHome, marker })

  it('writes the entry and the icon where the menus look, on the first launch', () => {
    expect(install()).toBe('installed')
    const paths = desktopPaths(dataHome)
    expect(paths.entry).toBe(join(dataHome, 'applications', 'havefish.desktop'))
    expect(paths.icon).toBe(join(dataHome, 'icons/hicolor/scalable/apps/havefish.svg'))
    expect(readFileSync(paths.entry, 'utf8')).toBe(desktopEntry('/home/me/havefish', paths.icon))
    expect(readFileSync(paths.icon, 'utf8')).toBe(icon)
    // Readable by the desktop, which may not run as a login shell of this user.
    expect(statSync(paths.entry).mode & 0o777).toBe(0o644)
    expect(existsSync(`${paths.entry}.partial`)).toBe(false)
    expect(existsSync(marker)).toBe(true)
  })

  it('leaves a correct entry alone', () => {
    install()
    const before = statSync(desktopPaths(dataHome).entry).mtimeMs
    expect(install()).toBe('unchanged')
    expect(statSync(desktopPaths(dataHome).entry).mtimeMs).toBe(before)
  })

  it('follows the binary when it moves, and a release whose icon changed', () => {
    install()
    expect(install('/opt/havefish')).toBe('updated')
    expect(readFileSync(desktopPaths(dataHome).entry, 'utf8')).toContain('Exec="/opt/havefish"')
    expect(install('/opt/havefish', '<svg id="new"/>')).toBe('updated')
    expect(readFileSync(desktopPaths(dataHome).icon, 'utf8')).toBe('<svg id="new"/>')
  })

  it('does not put back an entry its owner deleted', () => {
    install()
    rmSync(desktopPaths(dataHome).entry)
    expect(install()).toBe('removed')
    expect(install('/opt/havefish')).toBe('removed')
    expect(existsSync(desktopPaths(dataHome).entry)).toBe(false)
  })

  it('writes one again for a data directory that has never had one', () => {
    install()
    rmSync(desktopPaths(dataHome).entry)
    rmSync(marker)
    expect(install()).toBe('installed')
  })
})
