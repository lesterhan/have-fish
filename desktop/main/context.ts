// What a command runs against: the open ledger, the time, and the one way it writes.

import type { Changed } from '../shared/commands'
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

export const systemTime: Time = {
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
}

export function contextFor(
  ledger: Ledger,
  announce: (changed: Changed[]) => void,
  time: Time = systemTime,
  machine: Machine = forgetful(),
): Context {
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
