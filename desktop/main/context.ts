// What a command runs against: the open ledger, the time, and the one way it writes.

import type { Changed } from '../shared/commands'
import type { ThemeChoice } from '../shared/theme/theme'
import type { Ledger } from './db/ledger'
import { applyLocal, type BatchOutcome, type Written } from './ledger/apply'
import { forgetful, type Machine } from './machine'
import { History } from './undo/history'
import type { Step } from './undo/steps'

export type Time = {
  /** UTC ms. */
  now(): number
  /** The machine's IANA time zone, which says what day it is. */
  timeZone(): string
}

const systemTime: Time = {
  now: () => Date.now(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
}

export type Context = Time & {
  ledger: Ledger
  /** `applyLocal`, keeping what it wrote for the next `flush`. */
  apply(docs: unknown[], now: number): BatchOutcome
  /** Tells the window what changed since the last flush, each document once; nothing if nothing did. */
  flush(): void
  /** What this session can undo and redo. It starts empty each time the ledger opens. */
  history: History<Step>
  /** What this machine remembers between runs: never in the ledger. */
  machine: Machine
  /** Repaints the window in a theme. Electron's, so tests pass their own. */
  showTheme(choice: ThemeChoice): void
  /** Writes text to the system clipboard. Electron's, so tests pass their own. */
  copy(text: string): void
}

/** What a context is made of. Left out, the time is the system's and the rest do nothing. */
export type ContextParts = {
  ledger: Ledger
  /** Tells the window what changed. */
  announce(changed: Changed[]): void
  time?: Time
  machine?: Machine
  showTheme?(choice: ThemeChoice): void
  copy?(text: string): void
}

export function contextFor({
  ledger,
  announce,
  time = systemTime,
  machine = forgetful(),
  showTheme = () => {},
  copy = () => {},
}: ContextParts): Context {
  let written: Written[] = []
  return {
    ledger,
    now: () => time.now(),
    timeZone: () => time.timeZone(),
    apply(docs, now) {
      const applied = applyLocal(ledger, docs, now)
      if (applied.ok) written.push(...applied.value.written)
      return applied
    },
    flush() {
      if (written.length === 0) return
      const changed = changesOf(written)
      written = []
      announce(changed)
    },
    history: new History(),
    machine,
    showTheme,
    copy,
  }
}

/** Each document once, however many versions of it the batch wrote. */
export function changesOf(written: Written[]): Changed[] {
  const seen = new Map<string, Changed>()
  for (const { type, id } of written) {
    if (!seen.has(`${type}:${id}`)) seen.set(`${type}:${id}`, { type, id })
  }
  return [...seen.values()]
}
