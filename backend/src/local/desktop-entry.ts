// The Linux install story (#338): download the binary, `chmod +x`, run it once, and from then
// on it is in the applications menu. The first launch writes a desktop entry and the app's icon
// under `$XDG_DATA_HOME`, where every freedesktop menu (GNOME, KDE, XFCE, …) looks for the
// current user's own applications. Nothing is written outside the user's home, and nothing
// needs root.
//
// Two rules keep it from being a nuisance. An entry the person deleted stays deleted: the data
// directory remembers that one was installed, and a missing entry after that is a choice. And
// an entry that points at the wrong place is rewritten: move the binary, or replace it with a
// release that has a new icon, and the next launch from the new file puts the entry right.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Where the entry and its icon go, under `$XDG_DATA_HOME` (`data-dir.ts`, `xdgDataHome`). */
export function desktopPaths(dataHome: string) {
  return {
    entry: join(dataHome, 'applications', 'havefish.desktop'),
    icon: join(dataHome, 'icons', 'hicolor', 'scalable', 'apps', 'havefish.svg'),
  }
}

/** A value of type string in a desktop entry: a backslash is written as two (spec §"Possible value types"). */
function stringValue(value: string): string {
  // Nothing can write a newline or a tab into one line of the file and mean it; such a path is
  // someone's accident, and an entry that half-works is worse than none.
  if (/[\n\r\t\0]/.test(value))
    throw new Error(`cannot write ${JSON.stringify(value)} into a desktop entry`)
  return value.replace(/\\/g, '\\\\')
}

/**
 * The Exec key for a binary at `path` (spec §"The Exec key"): the path quoted, with `"`, `` ` ``,
 * `$` and `\` escaped inside the quotes, then the string escape on top, so a literal backslash
 * becomes four. `%` starts a field code, so a literal one is doubled.
 */
export function execValue(path: string): string {
  const quoted = `"${path.replace(/["`$\\]/g, (c) => `\\${c}`)}"`
  return stringValue(quoted).replace(/%/g, '%%')
}

/** The entry itself. The icon is named by its path, which needs no icon cache to be found. */
export function desktopEntry(executable: string, iconPath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.5',
    'Name=have-fish',
    'GenericName=Personal finance',
    'Comment=Your ledger, kept on this computer',
    `Exec=${execValue(executable)}`,
    `Icon=${stringValue(iconPath)}`,
    // It opens a browser tab and has no window of its own, so a launch cursor would spin on
    // until the desktop gave up on it.
    'Terminal=false',
    'StartupNotify=false',
    'Categories=Office;Finance;',
    'Keywords=money;budget;ledger;accounts;expenses;',
    '',
  ].join('\n')
}

/** What a launch did about the entry. */
export type DesktopEntryResult = 'installed' | 'updated' | 'unchanged' | 'removed'

/** Writes `contents` beside `path` and renames it over, so a menu watching the folder never reads half a file. */
function writeWhole(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const partial = `${path}.partial`
  writeFileSync(partial, contents, { mode: 0o644 })
  renameSync(partial, path)
}

const unchanged = (path: string, contents: string) =>
  existsSync(path) && readFileSync(path, 'utf8') === contents

/**
 * Puts the binary at `executable` in the applications menu, with `icon` (an SVG's text) as its
 * icon. `marker` is a file in the data directory that says an entry was installed once.
 */
export function installDesktopEntry(options: {
  executable: string
  icon: string
  dataHome: string
  marker: string
}): DesktopEntryResult {
  const paths = desktopPaths(options.dataHome)
  const entry = desktopEntry(options.executable, paths.icon)
  const present = existsSync(paths.entry)
  if (!present && existsSync(options.marker)) return 'removed'
  if (unchanged(paths.entry, entry) && unchanged(paths.icon, options.icon)) return 'unchanged'

  // The icon first: an entry naming an icon that is not there yet shows a blank square.
  writeWhole(paths.icon, options.icon)
  writeWhole(paths.entry, entry)
  writeFileSync(options.marker, `${paths.entry}\n`, { mode: 0o600 })
  return present ? 'updated' : 'installed'
}
