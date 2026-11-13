// The path picker's rules: which paths it offers, what a level's children are, what letters find,
// where the trail is, and what a name not used yet would create.

import { isAddable } from '@have-fish/core/account-kind'
import { nameOf } from '@have-fish/core/account-path'
import { UNSORTED } from '@have-fish/core/own-accounts'
import type { ListedPath } from '../../shared/commands'
import { finds } from './picker'

export type Mode = 'from' | 'to'

/** One thing the picker offers: an account, or a part of a path with accounts under it. */
export type Pick = {
  /** Its whole path, root and all. */
  path: string
  /** What it reads as, without its root. */
  name: string
  /** Whether the path itself is an account, so it can be picked. */
  pickable: boolean
  /** Whether paths are under it, so it can be opened. */
  hasChildren: boolean
  /** UTC ms of the latest live transaction that used it, or under it; null for never. */
  lastUsed: number | null
}

export type TrailPart = { name: string; path: string; root: boolean }

const ROOTS: Record<Mode, readonly string[]> = {
  from: ['assets', 'liabilities', 'income'],
  to: ['expenses', 'assets', 'liabilities'],
}

const ALL_ROOTS = ['assets', 'liabilities', 'expenses', 'income', 'equity']

/** The first part of a path: `liabilities` in `liabilities:cibc:visa`. */
export const rootOfPath = (path: string) => path.split(':')[0] ?? ''

/** What a pick puts in the field: its path without the root, never a level's name alone. */
export const textOf = (pick: Pick) => nameOf(pick.path)

/** The path a field's text names, by its name or its whole path, without regard to case. */
export function pathNamed(paths: readonly ListedPath[], text: string): ListedPath | undefined {
  const typed = text.trim().toLowerCase()
  if (typed === '') return undefined
  return paths.find((p) => nameOf(p.path).toLowerCase() === typed || p.path.toLowerCase() === typed)
}

/** The path a level is under: `assets:tangerine` in `assets:tangerine:chequing`; '' at a root. */
export const parentsOf = (path: string) => {
  const at = path.lastIndexOf(':')
  return at === -1 ? '' : path.slice(0, at)
}

/** The paths a picker of this mode may offer: what can pay or receive, and income or categories. */
export function offered(paths: readonly ListedPath[], mode: Mode): ListedPath[] {
  return paths.filter((p) => {
    // What an empty To means: never offered as a path.
    if (p.path === UNSORTED.path) return false
    if (!ROOTS[mode].includes(rootOfPath(p.path))) return false
    return mode === 'from'
      ? isAddable(p.kind) || p.kind === 'income'
      : p.kind === 'category' || isAddable(p.kind)
  })
}

const byLastUsed = (a: Pick, b: Pick) =>
  (b.lastUsed ?? -1) - (a.lastUsed ?? -1) || a.name.localeCompare(b.name)

/**
 * What a level offers: its direct children, a leaf for an account there and a part for one with
 * children under it, the ones used last first. No level: every path itself.
 */
export function childrenAt(paths: readonly ListedPath[], level: string | null): Pick[] {
  if (level === null) {
    return paths
      .map((p) => ({
        path: p.path,
        name: nameOf(p.path),
        pickable: true,
        hasChildren: paths.some((other) => other.path.startsWith(`${p.path}:`)),
        lastUsed: p.lastUsed,
      }))
      .sort(byLastUsed)
  }
  const prefix = `${level}:`
  const children = new Map<string, Pick>()
  for (const p of paths) {
    if (!p.path.startsWith(prefix)) continue
    const rest = p.path.slice(prefix.length)
    const at = rest.indexOf(':')
    const name = at === -1 ? rest : rest.slice(0, at)
    const path = `${prefix}${name}`
    const seen = children.get(name)
    if (seen === undefined) {
      children.set(name, {
        path,
        name,
        pickable: p.path === path,
        hasChildren: p.path !== path,
        lastUsed: p.lastUsed,
      })
    } else {
      seen.pickable ||= p.path === path
      seen.hasChildren ||= p.path !== path
      if (p.lastUsed !== null && (seen.lastUsed === null || p.lastUsed > seen.lastUsed)) {
        seen.lastUsed = p.lastUsed
      }
    }
  }
  return [...children.values()].sort(byLastUsed)
}

/** Every path with what was typed in order anywhere in its name, without its root. */
export function searching(paths: readonly ListedPath[], typed: string): Pick[] {
  const needle = needleOf(typed)
  if (needle === '') return []
  return paths
    .filter((p) => finds(nameOf(p.path), needle))
    .map((p) => ({
      path: p.path,
      name: nameOf(p.path),
      pickable: true,
      hasChildren: paths.some((other) => other.path.startsWith(`${p.path}:`)),
      lastUsed: p.lastUsed,
    }))
    .sort(byLastUsed)
}

/** A typed path without its root: `assets:cibc` as `cibc`. */
function withoutRoot(typed: string): string {
  const [root = '', ...rest] = typed.trim().split(':')
  return ALL_ROOTS.includes(root) ? rest.join(':') : typed.trim()
}

/** What the search looks for: what is after the last colon of the typed path. */
export function needleOf(typed: string): string {
  const path = withoutRoot(typed)
  return path.slice(path.lastIndexOf(':') + 1).trim()
}

/** The root a typed path names, or null when it names none. */
export function typedRootOf(typed: string): string | null {
  const root = typed.trim().split(':')[0] ?? ''
  return ALL_ROOTS.includes(root) ? root : null
}

/**
 * The level a typed path has reached: `food:co` under expenses reaches `expenses:food`; no colon
 * leaves the level where it was.
 */
export function levelOfTyped(level: string | null, typed: string, mode: Mode): string | null {
  const path = withoutRoot(typed)
  const at = path.lastIndexOf(':')
  if (at === -1) return level
  const head = path.slice(0, at)
  if (head === '') return level
  const root =
    typedRootOf(typed) ??
    (level === null ? (mode === 'to' ? 'expenses' : 'assets') : rootOfPath(level))
  return `${root}:${head}`
}

/** The trail to a level: its root and each part under it, each a path back to that level. */
export function trailOf(level: string | null): TrailPart[] {
  if (level === null || level === '') return []
  const parts = level.split(':')
  return parts.map((name, i) => ({
    name,
    path: parts.slice(0, i + 1).join(':'),
    root: i === 0,
  }))
}

/**
 * What a name not used yet would create: a category for To, an income source for From, under
 * the level in view unless the typed path names its own.
 */
export function createPath(
  mode: Mode,
  level: string | null,
  typed: string,
): { path: string; name: string } | null {
  let name = withoutRoot(typed).replace(/:+$/, '')
  if (name === '') return null
  // At a root, nameOf gives the root itself: a new name goes straight under it.
  const under = level?.includes(':') ? nameOf(level) : ''
  if (!name.includes(':') && under !== '') name = `${under}:${name}`
  return { path: `${mode === 'from' ? 'income' : 'expenses'}:${name}`, name }
}
