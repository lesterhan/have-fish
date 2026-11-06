// The undo history's steps as the ledger sees them: the documents one thing you did changed,
// each as it was before and after. Undo writes the befores again and redo the afters, each as
// a new version through apply, and only while the ledger still holds what the step left there.

import type { LedgerDocument } from '@have-fish/core/documents'
import { type Failure, failure, type Outcome } from '@have-fish/core/outcome'
import { compareVersions, type Version } from '@have-fish/core/version'
import type { Moved, Values } from '../../shared/commands'
import type { StepName } from '../../shared/steps'
import type { Context } from '../context'
import type { BatchOutcome } from '../ledger/apply'
import { getDocument } from '../ledger/store'

/**
 * One document a step changed: what it was before (null if the step made it) and after, each
 * with the version that state has in the ledger now. Undoing or redoing rewrites a state at a
 * new version, and the version follows it.
 */
export type Change = {
  type: LedgerDocument['type']
  id: string
  before: { doc: LedgerDocument | null; version: Version | null }
  after: { doc: LedgerDocument; version: Version }
}

/** `shows`: where the window looks after an undo or redo, when not at what changed. */
export type Step = { name: StepName; changes: Change[]; shows?: Moved }

/**
 * `ctx.apply(docs)`, and the changes it made to `kept`: the documents the step is about. The
 * accounts a spend makes along the way are left out, so undo never takes the wallet away.
 */
export function applyKeeping(
  ctx: Context,
  docs: LedgerDocument[],
  now: number,
  kept: readonly LedgerDocument[],
): { applied: BatchOutcome; changes: Change[] } {
  const { db } = ctx.ledger
  const befores = kept.map((d) => getDocument(db, d.type, d.id))
  const applied = ctx.apply(docs, now)
  if (!applied.ok) return { applied, changes: [] }

  const written = versionsIn(applied)
  const changes = kept.flatMap((d, i): Change[] => {
    const version = written.get(keyOf(d))
    const stored = getDocument(db, d.type, d.id)
    if (version === undefined || stored === null) return []
    const before = befores[i] ?? null
    return [
      {
        type: d.type,
        id: d.id,
        before: { doc: before?.doc ?? null, version: before?.version ?? null },
        after: { doc: stored.doc, version },
      },
    ]
  })
  return { applied, changes }
}

/** Puts `changes` on the history as one step, unless nothing changed. */
export function record(ctx: Context, name: StepName, changes: Change[], shows?: Moved): void {
  if (changes.length > 0) ctx.history.record(shows ? { name, changes, shows } : { name, changes })
}

/** What Undo and Redo would take back or put back, by name: the palette says them (see #616). */
export function nextSteps(ctx: Context): Values['ledger.steps'] {
  return {
    undo: ctx.history.nextUndo()?.name ?? null,
    redo: ctx.history.nextRedo()?.name ?? null,
  }
}

/** Takes back the newest step. A step that can't be is refused whole, and leaves the history. */
export function undoLast(ctx: Context): Outcome<Moved> {
  const { history } = ctx
  const step = history.nextUndo()
  if (step === undefined) return { ok: true, value: NOTHING }

  const moved = writeBack(ctx, step, 'undo')
  if (!moved.ok) {
    history.dropUndo()
    return moved
  }
  history.undid()
  history.map(followed(step, 'undo', moved.value))
  return { ok: true, value: movedBy(step) }
}

/** Puts back the newest step undone, under the same rules. */
export function redoLast(ctx: Context): Outcome<Moved> {
  const { history } = ctx
  const step = history.nextRedo()
  if (step === undefined) return { ok: true, value: NOTHING }

  const moved = writeBack(ctx, step, 'redo')
  if (!moved.ok) {
    history.dropRedo()
    return moved
  }
  history.redid()
  history.map(followed(step, 'redo', moved.value))
  return { ok: true, value: movedBy(step) }
}

type Direction = 'undo' | 'redo'

/** The version each document of a step was written at, by `keyOf`. */
type Written = Map<string, Version>

/**
 * Writes the state `direction` goes to, as one batch, if the ledger still holds the one it
 * leaves. Versions are compared, never bodies: an edit from elsewhere that happens to match is
 * still a change since.
 */
function writeBack(ctx: Context, step: Step, direction: Direction): Outcome<Written> {
  const { db } = ctx.ledger
  for (const c of step.changes) {
    const leaving = direction === 'undo' ? c.after.version : c.before.version
    const stored = getDocument(db, c.type, c.id)?.version ?? null
    if (!same(stored, leaving)) return failure('CHANGED_SINCE', { id: c.id })
  }

  const now = ctx.now()
  const docs = step.changes.map((c) =>
    direction === 'redo' ? c.after.doc : (c.before.doc ?? tombstoneOf(c.after.doc, now)),
  )
  const applied = ctx.apply(docs, now)
  if (!applied.ok) {
    const { code, details } = applied.failure
    return { ok: false, failure: { code, details } as Failure }
  }
  return { ok: true, value: versionsIn(applied) }
}

/**
 * After `step` went `direction`, each state it rewrote has a new version, here and in the step
 * next to it in the history: the one whose after was this step's before (undo), or whose before
 * was this step's after (redo). A version written anywhere else is a change since, and stays one.
 */
function followed(step: Step, direction: Direction, written: Written) {
  const moves = step.changes.map((c) => ({
    key: keyOf(c),
    from: direction === 'undo' ? c.before.version : c.after.version,
    to: written.get(keyOf(c)),
  }))

  return (other: Step): Step => ({
    ...other,
    changes: other.changes.map((c) => {
      const move = moves.find((m) => m.key === keyOf(c))
      if (move?.to === undefined) return c
      if (other === step) {
        return direction === 'undo'
          ? { ...c, before: { ...c.before, version: move.to } }
          : { ...c, after: { ...c.after, version: move.to } }
      }
      if (direction === 'undo' && same(c.after.version, move.from)) {
        return { ...c, after: { ...c.after, version: move.to } }
      }
      if (direction === 'redo' && same(c.before.version, move.from)) {
        return { ...c, before: { ...c.before, version: move.to } }
      }
      return c
    }),
  })
}

const same = (a: Version | null, b: Version | null) =>
  a === null || b === null ? a === b : compareVersions(a, b) === 0

const keyOf = (d: { type: string; id: string }) => `${d.type}:${d.id}`

const versionsIn = (applied: BatchOutcome & { ok: true }): Written =>
  new Map(applied.value.written.map((w) => [keyOf(w), w.version]))

function tombstoneOf(doc: LedgerDocument, now: number): LedgerDocument {
  return doc.type === 'transaction'
    ? { ...doc, postings: [], deletedAt: now }
    : { ...doc, deletedAt: now }
}

const NOTHING: Moved = { spends: [], accounts: [] }

const movedBy = (step: Step): Moved =>
  step.shows ?? {
    spends: step.changes.filter((c) => c.type === 'transaction').map((c) => c.id),
    accounts: step.changes.filter((c) => c.type === 'account').map((c) => c.id),
  }
