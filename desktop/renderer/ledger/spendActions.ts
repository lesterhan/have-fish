// What a place can do to a spend: write one, change one, refile one, remove one. Each sends its
// command and says saved, or why not in the words its place shows. No place or part sends a spend
// command itself.

import type { Bridge, InputOf, ListedTransaction, To } from '../shared/commands'
import { composerWordsFor, type Field, fieldOf, spendWordsFor, wordsFor } from './refusals'
import { changeOf, savedValues } from './sentence'

/** Refused, with the words to show. */
export type Refused = { ok: false; words: string }

export type Done = { ok: true } | Refused

export function spendActions(bridge: Pick<Bridge, 'invoke'>) {
  /** A change `changeOf` worked out: the card's chips. */
  async function edit(change: InputOf<'spend.edit'>): Promise<Done> {
    const saved = await bridge.invoke('spend.edit', change)
    return saved.ok ? { ok: true } : { ok: false, words: spendWordsFor(saved) }
  }

  return {
    /** The line's spend, written. Refused, it says which part to underline. */
    async write(
      values: InputOf<'spend.write'>,
    ): Promise<{ ok: true; id: string } | (Refused & { part: Field })> {
      const written = await bridge.invoke('spend.write', values)
      if (written.ok) return { ok: true, id: written.value.id }
      return { ok: false, part: fieldOf(written, values.to), words: composerWordsFor(written) }
    },

    edit,

    /** R: its To picked by path, the rest as it was. A To it has already sends nothing. */
    async refile(t: ListedTransaction, typed: string, toOf: (typed: string) => To): Promise<Done> {
      const saved = savedValues(t)
      const change = saved === null ? null : changeOf(t, saved, 'to', typed, toOf)
      return change === null ? { ok: true } : edit(change)
    },

    async remove(id: string): Promise<Done> {
      const removed = await bridge.invoke('spend.remove', { id })
      return removed.ok ? { ok: true } : { ok: false, words: wordsFor(removed) }
    },
  }
}

export type SpendActions = ReturnType<typeof spendActions>
