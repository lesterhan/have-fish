// What more than one feature's commands use: the bounds on typed text, money, and how an answer
// or a change crosses to the window.

import type { LedgerDocument } from '@have-fish/core/documents'
import type { Failure, FailureCode, FailureDetails } from '@have-fish/core/outcome'
import { z } from 'zod'

/** Long enough for anything typed by hand; the window is the least trusted process. */
export const typed = (max: number) => z.string().max(max)

/** A calendar day as typed, `YYYY-MM-DD`; main says whether it is one. */
export const date = typed(10)

export type Money = { amount: string; currency: string }

/** A refusal as it crosses to the window: today's `{ error: CODE, detail }`. */
export type WireFailure = {
  [C in FailureCode]: { ok: false; error: C; detail: FailureDetails[C] }
}[FailureCode]

export type Wire<T> = { ok: true; value: T } | WireFailure

export function wireFailure({ code, details }: Failure): WireFailure {
  // The pair came from one member of `Failure`, so it fits one member of `WireFailure`.
  return { ok: false, error: code, detail: details } as WireFailure
}

/** A document a command wrote, announced once per command after its last batch commits. */
export type Changed = { type: LedgerDocument['type']; id: string }

/** Whether Undo and Redo would take back or put back the focused field's typing. */
export type Typing = { undo: boolean; redo: boolean }
