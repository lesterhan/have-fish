// The one spend editor: every spend I'm changing, kept in the window until it's saved or put
// back, and the saves and removes that go to main. The ledger and Reports share it, so a draft
// made in one is the same draft in the other. No DOM: the bridge is passed in.

import type { Bridge, ListedTransaction, To, WireFailure } from '../shared/commands'
import {
  afterSaves,
  type Draft,
  type Drafts,
  editOf,
  type Sending,
  savedValues,
  toSend,
  type Values,
  withEdit,
  without,
} from './drafts'
import { type Option, toOf } from './picker'
import { fieldOf, spendWordsFor } from './refusals'

export type EditorState = {
  drafts: Drafts
  /** What each draft started from: where its money went and its day, as saved. */
  bases: ReadonlyMap<string, Values>
  /** A save is on its way. */
  saving: boolean
}

type Deps = {
  bridge: Pick<Bridge, 'invoke'>
  /** My accounts as they are now: a To naming one is a transfer. */
  accounts: () => readonly Option[]
  /** After a save or a remove: the fields' own undo has nothing left to take back. */
  forgetTyping: () => void
}

const EMPTY: EditorState = { drafts: new Map(), bases: new Map(), saving: false }

/** The editor over `bridge`; one per window. */
export function spendEditor({ bridge, accounts, forgetTyping }: Deps) {
  let state = EMPTY
  const listeners = new Set<(state: EditorState) => void>()

  function emit(next: Partial<EditorState>) {
    state = { ...state, ...next }
    // A base outlives its draft only until the next change.
    if (state.bases.size > state.drafts.size) {
      state = {
        ...state,
        bases: new Map([...state.bases].filter(([id]) => state.drafts.has(id))),
      }
    }
    for (const listener of listeners) listener(state)
  }

  const refusedFor = (refused: WireFailure | null, to?: To): Draft['error'] =>
    refused && { field: fieldOf(refused, to), words: spendWordsFor(refused) }

  /** A draft as main takes it, sending where it goes only if that changed. */
  const sent = (s: Sending) => {
    const base = state.bases.get(s.id)
    return editOf(s, base?.to, (typed) => toOf(accounts(), typed), base?.date)
  }

  async function sentOne(sending: Sending[]) {
    return Promise.all(
      sending.map(async (s) => {
        const edit = sent(s)
        const saved = await bridge.invoke('spend.edit', edit)
        return { ...s, error: refusedFor(saved.ok ? null : saved, edit.to) }
      }),
    )
  }

  /** Ctrl+S's drafts go as one command, so undo takes them back as one step. */
  async function sentAll(sending: Sending[]) {
    const edits = sending.map(sent)
    const saved = await bridge.invoke('spend.saveAll', { edits })
    if (!saved.ok) return sending.map((s) => ({ ...s, error: refusedFor(saved) }))
    return sending.map((s, i) => ({
      ...s,
      error: refusedFor(saved.value[i]?.refused ?? null, edits[i]?.to),
    }))
  }

  return {
    subscribe(listener: (state: EditorState) => void): () => void {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },

    current: (): EditorState => state,

    /** After typing `value` into `field` of `t`. Typed back to what's saved, the draft goes. */
    edit(t: ListedTransaction, field: keyof Values, value: string) {
      const saved = state.bases.get(t.id) ?? savedValues(t)
      if (saved === null) return
      const bases = state.bases.has(t.id) ? state.bases : new Map(state.bases).set(t.id, saved)
      emit({ drafts: withEdit(state.drafts, t.id, saved, field, value), bases })
    },

    /** Puts `id` back as it's saved. */
    revert(id: string) {
      if (state.drafts.has(id)) emit({ drafts: without(state.drafts, id) })
    },

    /**
     * Saves the drafts of `ids`: each its own step, or with `all` one step for undo. `caughtUp`
     * brings the place's lists up to date first, so nothing shows the old values in between.
     * Each one refused keeps its draft, saying why.
     */
    async save(ids: Iterable<string>, all: boolean, caughtUp: () => Promise<void>) {
      const sending = toSend(state.drafts, ids)
      if (sending.length === 0 || state.saving) return
      emit({ saving: true })
      const saves = await (all ? sentAll(sending) : sentOne(sending))
      if (saves.some((s) => s.error === null)) {
        forgetTyping()
        await caughtUp()
      }
      emit({ drafts: afterSaves(state.drafts, saves), saving: false })
    },

    /** Removes `id`, and its draft with it; the refusal if main said no. */
    async remove(id: string): Promise<WireFailure | null> {
      const removed = await bridge.invoke('spend.remove', { id })
      if (!removed.ok) return removed
      emit({ drafts: without(state.drafts, id) })
      forgetTyping()
      return null
    },
  }
}

export type SpendEditor = ReturnType<typeof spendEditor>
