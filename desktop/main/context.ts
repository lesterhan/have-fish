// What a command runs against: the open ledger, the time, and the one way it writes.

import type { Changed } from '../shared/commands'
import type { Ledger } from './db/ledger'
import { applyLocal, type BatchOutcome, type Written } from './ledger/apply'
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
  /** `applyLocal`, then the window hears what changed: once per batch that wrote anything. */
  apply(docs: unknown[], now: number): BatchOutcome
  /** What this session can undo and redo. It starts empty each time the ledger opens. */
  history: History<Step>
}

export function contextFor(
  ledger: Ledger,
  announce: (changed: Changed[]) => void,
  time: Time = systemTime,
): Context {
  return {
    ledger,
    now: () => time.now(),
    timeZone: () => time.timeZone(),
    apply(docs, now) {
      const applied = applyLocal(ledger, docs, now)
      if (applied.ok && applied.value.written.length > 0) {
        announce(changesOf(applied.value.written))
      }
      return applied
    },
    history: new History(),
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
